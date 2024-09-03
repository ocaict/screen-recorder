$(document).ready(async () => {
  $(".file-menu-btn").click(async () => {
    const result = await api.showFileMenu("file");
    console.log(result);
  });

  $(".edit-menu-btn").click(async () => {
    const result = await api.showFileMenu("edit");
    console.log(result);
  });

  $(".minimize-btn").click(async () => {
    await api.minimizeWindow();
  });

  $(".restore-maximize-btn").click(async function () {
    const result = await api.restoreOrMaximizeWindow();
    const btn = document.querySelector(".restore-maximize-btn");
    btn.title = `${result ? "Restore" : "Maximize"}`;
    btn.innerHTML = `<i class="fas fa-window-${
      result ? "restore" : "maximize"
    }"></i>`;
  });

  $(".exit-btn").click(async () => {
    await api.closeApp();
  });
  $(".capture-btn").click(async () => {
    const result = await api.getCaptureSources();
    console.log(result);
  });

  $(".hide-recorder-btn").click(async () => {
    const result = await api.hideRecorder();
    console.log(result);
  });
});
