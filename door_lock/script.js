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

// DOM 載入完成後執行
document.addEventListener('DOMContentLoaded', () => {
  // 取得 DOM 元素
  const video1 = document.getElementById('inputVideo');
  const inputtext = document.getElementById('inputtext');
  const inputtextUser = document.getElementById('inputtextUser');
  const mask = document.getElementById('mask');
  const loadImg = document.getElementById('loadImg');

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

  // 載入模型並啟動攝影機
  Promise.all([
    mask.style.display = "block",
    loadImg.style.display = "block",
    faceapi.nets.ssdMobilenetv1.loadFromUri('./models'),
    faceapi.nets.faceRecognitionNet.loadFromUri('./models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('./models'),
    console.log("模型載入成功"),
    checkCookie()
  ]).then(() => startVideo(video1, mask, loadImg)).catch(err => console.error("初始化失敗:", err));

  async function startVideo(video, mask, loadImg) {
    if (!video) {
      console.error("Video element not found");
      return;
    }
    await navigator.mediaDevices.getUserMedia({ video: {} })
      .then(stream => {
        video.srcObject = stream;
      })
      .catch(err => console.error("攝影機啟動失敗:", err));
    await video.play();
    recognizeFacesContinuously(video, mask, loadImg);
  }

  let labeledDescriptors;
  let faceMatcher;
  let canvas;
  let displaySize;

  async function recognizeFacesContinuously(video, mask, loadImg) {
    if (!video) return;

    labeledDescriptors = await loadLabel();
    faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.7);
    canvas = faceapi.createCanvasFromMedia(video);
    if (!canvas) {
      console.error("無法創建 Canvas");
      return;
    }
    document.body.append(canvas);
    mask.style.display = "none";
    loadImg.style.display = "none";

    canvas.style.left = getPosition(video)["x"] + "px";
    canvas.style.top = getPosition(video)["y"] + "px";
    displaySize = { width: video.offsetWidth, height: video.offsetHeight };
    faceapi.matchDimensions(canvas, displaySize);

    let lastUpload = new Date().getTime() - 2000;
    setInterval(async () => {
      if (!canvas || !video) return; // 防止 canvas 或 video 為 null
      inputtext.style.width = video.offsetWidth + "px";
      inputtext.style.height = (video.offsetHeight / 8) + "px";
      inputtextUser.style.width = video.offsetWidth + "px";
      inputtextUser.style.height = (video.offsetHeight / 8) + "px";
      displaySize = { width: video.offsetWidth, height: video.offsetHeight };
      faceapi.matchDimensions(canvas, displaySize);

      const detections = await faceapi.detectAllFaces(video)
        .withFaceLandmarks()
        .withFaceDescriptors();
      const resizedDetections = faceapi.resizeResults(detections, displaySize);
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);

      const results = resizedDetections.map(d => faceMatcher.findBestMatch(d.descriptor));
      results.forEach((result, i) => {
        const box = resizedDetections[i].detection.box;
        const drawBox = new faceapi.draw.DrawBox(box, { label: result.toString() });
        drawBox.draw(canvas);

        const currentTime = new Date().getTime();
        if (currentTime - lastUpload >= 2000) {
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
    }, 100);
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
});
