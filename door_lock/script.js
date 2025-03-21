// 儲存 cookie
function setCookie(cname, cvalue, exdays) {
  let d = new Date();
  d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000));
  let expires = "expires=" + d.toGMTString();
  document.cookie = cname + "=" + cvalue + "; " + expires;
}

// 取得 cookie
function getCookie(cname) {
  let name = cname + "=";
  let ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i].trim();
    if (c.indexOf(name) == 0) return c.substring(name.length, c.length);
  }
  return "";
}

// 取得 DOM 元素
const video1 = document.getElementById('inputVideo');
const inputtext = document.getElementById('inputtext');
const inputtextUser = document.getElementById('inputtextUser');
const mask = document.getElementById('mask');
const loadImg = document.getElementById('loadImg');
const startBtn = document.getElementById('startRecognition');

// 檢查並更新 Cookie
function checkCookie() {
  let key = getCookie("key");
  let name = getCookie("name");
  if (key) inputtext.value = key;
  if (name) inputtextUser.value = name;

  if (inputtext.value !== key) setCookie("key", inputtext.value, 30);
  if (inputtextUser.value !== name) setCookie("name", inputtextUser.value, 30);
}

// 取得人名列表
let labelStr = getCookie("labelStr") || "black,robobo";
labelStr = prompt("請輸入名稱並以逗號隔開人名:", labelStr);
let labels = labelStr.split(",");

// 圓角輸入框
$('input:text').addClass("ui-widget ui-widget-content ui-corner-all ui-textfield");

// MQTT 客戶端設置
const mqttClient = mqtt.connect('wss://io.adafruit.com:443/mqtt', {
  username: inputtextUser.value || '',
  password: inputtext.value || '',
  clientId: 'web_client_' + Math.random().toString(16).substr(2, 8)
});

mqttClient.on('connect', () => console.log('MQTT 連接成功'));
mqttClient.on('error', (err) => console.log('MQTT 錯誤:', err));
mqttClient.on('message', (topic, message) => {
  console.log(`收到訊息 - Topic: ${topic}, Message: ${message.toString()}`);
});

// 載入模型
let labeledDescriptors;
let faceMatcher;
let canvas;
let displaySize;
let recognitionInterval;

Promise.all([
  mask.style.display = "block",
  loadImg.style.display = "block",
  faceapi.nets.ssdMobilenetv1.loadFromUri('./models'),
  faceapi.nets.faceRecognitionNet.loadFromUri('./models'),
  faceapi.nets.faceLandmark68Net.loadFromUri('./models'),
  console.log("模型載入成功"),
  checkCookie()
]).then(() => {
  mask.style.display = "none";
  loadImg.style.display = "none";
  startBtn.addEventListener('click', startRecognition);
});

async function startRecognition() {
  console.log("開始辨識");
  // 如果正在辨識，先停止
  if (recognitionInterval) stopRecognition();

  const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
  video1.srcObject = stream;
  await video1.play();

  if (!labeledDescriptors) {
    labeledDescriptors = await loadLabel();
    faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.7);
  }
  canvas = faceapi.createCanvasFromMedia(video1);
  document.body.append(canvas);
  canvas.style.left = getPosition(video1)["x"] + "px";
  canvas.style.top = getPosition(video1)["y"] + "px";
  displaySize = { width: video1.offsetWidth, height: video1.offsetHeight };
  faceapi.matchDimensions(canvas, displaySize);

  let latestResult = "unknown";
  recognitionInterval = setInterval(async () => {
    if (!canvas) return; // 若 canvas 不存在，直接退出
    displaySize = { width: video1.offsetWidth, height: video1.offsetHeight };
    faceapi.matchDimensions(canvas, displaySize);

    const detections = await faceapi.detectAllFaces(video1)
      .withFaceLandmarks()
      .withFaceDescriptors();
    const resizedDetections = faceapi.resizeResults(detections, displaySize);
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);

    const results = resizedDetections.map(d => faceMatcher.findBestMatch(d.descriptor));
    results.forEach((result, i) => {
      const box = resizedDetections[i].detection.box;
      const drawBox = new faceapi.draw.DrawBox(box, { label: result.toString() });
      drawBox.draw(canvas);
      latestResult = result.label;
    });
  }, 100);

  setTimeout(() => {
    stopRecognition();
    console.log("5秒結束，最新結果:", latestResult);
    if (inputtextUser.value && inputtext.value) {
      const topic = `${inputtextUser.value}/feeds/face`;
      console.log("上傳至:", topic);
      mqttClient.publish(topic, latestResult, {}, (err) => {
        if (!err) console.log(`MQTT 上傳 ${latestResult} 至 ${topic}`);
        else console.log("MQTT 上傳失敗:", err);
      });
    } else {
      console.log("使用者名稱或金鑰未填寫");
    }
  }, 5000);
}

function stopRecognition() {
  if (recognitionInterval) {
    clearInterval(recognitionInterval);
    recognitionInterval = null;
  }
  if (video1.srcObject) {
    video1.srcObject.getTracks().forEach(track => track.stop());
    video1.srcObject = null;
  }
  if (canvas) {
    canvas.remove();
    canvas = null;
  }
}

async function loadLabel() {
  return Promise.all(
    labels.map(async (label) => {
      const descriptions = [];
      for (let i = 1; i <= 4; i++) {
        try {
          const img = await faceapi.fetchImage(`images/${label}/${i}.jpg`);
          const detections = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
          if (detections) descriptions.push(detections.descriptor);
          else alert(`無法提取 ${label}/${i}.jpg 的人臉特徵`);
        } catch (e) {
          console.log(`錯誤於 ${label}/${i}.jpg: ${e}`);
        }
      }
      if (descriptions.length > 0) setCookie("labelStr", labelStr, 30);
      return new faceapi.LabeledFaceDescriptors(label, descriptions);
    })
  );
}

function getPosition(element) {
  let x = 0, y = 0;
  while (element) {
    x += element.offsetLeft - element.scrollLeft + element.clientLeft;
    y += element.offsetTop - element.scrollLeft + element.clientTop;
    element = element.offsetParent;
  }
  return { x: x, y: y };
}
