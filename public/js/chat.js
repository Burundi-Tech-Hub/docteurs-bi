(() => {
  const root = document.querySelector('.chat');
  if (!root) return;
  const slug = root.dataset.current;
  const me = Number(root.dataset.me);
  const log = document.getElementById('log');
  const empty = document.getElementById('empty');
  const form = document.getElementById('chat-form');
  const body = document.getElementById('body');
  const socket = window.mddSocket || io();

  const fmtTime = (s) => {
    const d = new Date(s.replace(' ', 'T') + 'Z');
    return d.toLocaleString(document.documentElement.lang, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  function render(m) {
    empty.hidden = true;
    const el = document.createElement('div');
    el.className = 'msg' + (m.user_id === me ? ' mine' : '');
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = `${m.user_id === me ? '' : 'Dr ' + m.author + ' · '}${fmtTime(m.created_at)}`;
    const text = document.createElement('div');
    text.className = 'msg-body';
    text.textContent = m.body;
    el.append(meta, text);
    log.append(el);
  }

  const scroll = () => { log.scrollTop = log.scrollHeight; };

  socket.on('connect', () => {
    socket.emit('join', slug, (res) => {
      if (res.error) return;
      log.querySelectorAll('.msg').forEach((n) => n.remove());
      res.history.forEach(render);
      scroll();
    });
  });

  socket.on('message', (m) => {
    if (m.slug !== slug) return;
    render(m);
    scroll();
    socket.emit('read', m.id);
  });

  socket.on('notify', (n) => {
    if (n.slug === slug) return;
    const link = document.querySelector(`.chat-side a[data-slug="${CSS.escape(n.slug)}"]`);
    if (!link) return location.reload(); // new direct conversation
    let badge = link.querySelector('.badge');
    if (!badge) { badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = '0'; link.append(badge); }
    badge.textContent = String(Number(badge.textContent) + 1);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = body.value.trim();
    if (!text) return;
    socket.emit('message', text, (res) => { if (res.ok) body.value = ''; });
  });

  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
})();
