// 儲存 cookie(cookie的名字、cookie的值、儲存天數)
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
const inputtext = document.getElementById('inputtext'); // Adafruit IO Key
const inputtextUser = document.getElementById('inputtextUser'); // Adafruit IO Username
const mask = document.getElementById('mask');
const loadImg = document.getElementById('loadImg');

// 檢查並更新 Cookie
function checkCookie() {
  let key = getCookie("key");
  let name = getCookie("name");
  if (key != "") inputtext.value = key;
  if (name != "") inputtextUser.value = name;

  key = inputtext.value;
  name = inputtextUser.value;

  if (key != getCookie("key")) setCookie("key", key, 30);
  if (name != getCookie("name")) setCookie("name", name, 30);
}

// 取得人名列表
let labelStr = getCookie("labelStr");
if (labelStr == "") labelStr = "Teddy,Chuan";
labelStr = prompt("請輸入名稱並以逗號隔開人名:", labelStr);
let labels = labelStr.toString().split(",");

// 圓角輸入框 (需要 jQuery UI)
$('input:text').addClass("ui-widget ui-widget-content ui-corner-all ui-textfield");

// 載入模型並啟動攝影機
Promise.all([
  mask.style.display = "block",
  loadImg.style.display = "block",
  faceapi.nets.ssdMobilenetv1.loadFromUri('./models'),
  faceapi.nets.faceRecognitionNet.loadFromUri('./models'),
  faceapi.nets.faceLandmark68Net.loadFromUri('./models'),
  console.log("模型載入成功"),
  checkCookie()
]).then(startVideo);

async function startVideo() {
  await navigator.mediaDevices.getUserMedia({ video: {} })
    .then(function (stream) {
      video1.srcObject = stream;
    });
  await video1.play();
  recognizeFacesContinuously();
}

let labeledDescriptors;
let faceMatcher;
let canvas;
let displaySize;

async function recognizeFacesContinuously() {
  // 初始化人臉描述
  labeledDescriptors = await loadLabel();
  faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.7);
  canvas = faceapi.createCanvasFromMedia(video1);
  document.body.append(canvas);
  mask.style.display = "none";
  loadImg.style.display = "none";

  // 設定 Canvas 位置與大小
  canvas.style.left = getPosition(video1)["x"] + "px";
  canvas.style.top = getPosition(video1)["y"] + "px";
  displaySize = { width: video1.offsetWidth, height: video1.offsetHeight };
  faceapi.matchDimensions(canvas, displaySize);

  // 持續辨識
  let lastUpload = new Date().getTime() - 2000; // 控制上傳頻率
  setInterval(async () => {
    inputtext.style.width = video1.offsetWidth.toString() + "px";
    inputtext.style.height = (video1.offsetHeight / 8).toString() + "px";
    inputtextUser.style.width = video1.offsetWidth.toString() + "px";
    inputtextUser.style.height = (video1.offsetHeight / 8).toString() + "px";
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

      const currentTime = new Date().getTime();
      if (currentTime - lastUpload >= 10000) { // 每 10 秒上傳一次
        $.ajax({
          url: `https://io.adafruit.com/api/v2/${inputtextUser.value}/feeds/face/data?X-AIO-Key=${inputtext.value}`,
          type: "POST",
          data: { "value": result.label },
          success: () => console.log(`Uploaded ${result.label} to Adafruit IO`),
          error: (err) => console.log("Upload failed:", err)
        });
        lastUpload = currentTime;
      }
    });

    checkCookie();
  }, 1000); // 每 1000ms 檢查一次
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

// 取得元素位置
function getPosition(element) {
  let x = 0, y = 0;
  while (element) {
    x += element.offsetLeft - element.scrollLeft + element.clientLeft;
    y += element.offsetTop - element.scrollLeft + element.clientTop;
    element = element.offsetParent;
  }
  return { x: x, y: y };
}
