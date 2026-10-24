// Shows new public health alerts on any open page without a reload.
(() => {
  if (typeof io !== 'function') return;
  const script = document.currentScript;
  const socket = window.mddSocket = io();
  socket.on('alert', (a) => {
    const holder = document.getElementById('alert-banners');
    if (!holder) return;
    const link = document.createElement('a');
    link.className = `alert-banner alert-${a.level} alert-new`;
    link.href = `/alerts/${a.id}`;
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    const tag = document.createElement('span');
    tag.className = 'alert-tag';
    tag.textContent = script.dataset.live;
    const title = document.createElement('strong');
    title.textContent = a.title;
    const more = document.createElement('span');
    more.className = 'alert-more';
    more.textContent = `${script.dataset.more} →`;
    wrap.append(tag, title, more);
    link.append(wrap);
    holder.prepend(link);
  });
})();
