// NeuralTrace — Microphone permission request page
// Auto-requests mic access on load. Chrome shows its native permission prompt.
// Once granted, notifies the side panel and closes this tab.

const $status = document.getElementById("status");

if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  $status.textContent = "Media devices API not available. Close this tab and try again.";
  $status.className = "status error";
} else {
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      stream.getTracks().forEach(t => t.stop());
      $status.textContent = "Microphone allowed! Closing...";
      $status.className = "status success";
      chrome.runtime.sendMessage({ type: "mic-permission-result", granted: true });
      setTimeout(() => window.close(), 800);
    })
    .catch(err => {
      console.error("getUserMedia error:", err.name, err.message);
      $status.textContent = "Permission denied (" + err.name + "). Re-open and click Allow.";
      $status.className = "status error";
      chrome.runtime.sendMessage({ type: "mic-permission-result", granted: false, error: err.message });
    });
}
