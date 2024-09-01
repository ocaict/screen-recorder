const swiper = new Swiper(".swiper", {
  // Optional parameters
  direction: "horizontal",
  loop: true,

  // If we need pagination
  pagination: {
    el: ".swiper-pagination",
  },

  // Navigation arrows
  navigation: {
    nextEl: ".swiper-button-next",
    prevEl: ".swiper-button-prev",
  },

  // And if we need scrollbar
  scrollbar: {
    el: ".swiper-scrollbar",
  },
  autoplay: {
    delay: 5000,
  },
});

$(document).ready(() => {
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
});

// let r = Math.floor(Math.random() * 256);
//     let g = Math.floor(Math.random() * 256);
//     let b = Math.floor(Math.random() * 256);
//     this.style.backgroundColor = `rgb(${r},${g},${b})`;
