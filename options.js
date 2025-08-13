const DEFAULTS = {
  apiKey: '',
  cx: '',
  imgSize: 'xxlarge',
  minWidth: 2000,
  minHeight: 2000,
  minBytes: 1500000,
  exactDefault: true,
  blacklist: [
    'facebook.com','instagram.com','x.com','twitter.com','tiktok.com','pinterest.com','reddit.com',
    'youtube.com','youtu.be','wikipedia.org','wikimedia.org','wikiquote.org','fandom.com','wikia.com','quora.com','linkedin.com'
  ]
};

function getEls() {
  return {
    apiKey: document.getElementById('apiKey'),
    cx: document.getElementById('cx'),
    imgSize: document.getElementById('imgSize'),
    minWidth: document.getElementById('minWidth'),
    minHeight: document.getElementById('minHeight'),
    minBytes: document.getElementById('minBytes'),
    exactDefault: document.getElementById('exactDefault'),
    addDomain: document.getElementById('addDomain'),
    addBtn: document.getElementById('addBtn'),
    blacklist: document.getElementById('blacklist'),
    save: document.getElementById('save'),
    reset: document.getElementById('reset')
  };
}

function renderBlacklist(el, list) {
  el.innerHTML = '';
  list.forEach((d, idx) => {
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.innerHTML = `<span>${d}</span><button data-idx="${idx}">×</button>`;
    pill.querySelector('button').addEventListener('click', () => {
      list.splice(idx, 1);
      renderBlacklist(el, list);
    });
    el.appendChild(pill);
  });
}

async function load() {
  const els = getEls();
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  const cfg = Object.assign({}, DEFAULTS, stored);
  els.apiKey.value = cfg.apiKey;
  els.cx.value = cfg.cx;
  els.imgSize.value = cfg.imgSize;
  els.minWidth.value = cfg.minWidth;
  els.minHeight.value = cfg.minHeight;
  els.minBytes.value = cfg.minBytes;
  els.exactDefault.checked = cfg.exactDefault;
  renderBlacklist(els.blacklist, cfg.blacklist);

  els.addBtn.addEventListener('click', () => {
    const d = els.addDomain.value.trim();
    if (!d) return;
    cfg.blacklist.push(d);
    els.addDomain.value = '';
    renderBlacklist(els.blacklist, cfg.blacklist);
  });

  els.save.addEventListener('click', async () => {
    const saveCfg = {
      apiKey: els.apiKey.value.trim(),
      cx: els.cx.value.trim(),
      imgSize: els.imgSize.value,
      minWidth: Number(els.minWidth.value),
      minHeight: Number(els.minHeight.value),
      minBytes: Number(els.minBytes.value),
      exactDefault: els.exactDefault.checked,
      blacklist: Array.from(els.blacklist.querySelectorAll('.pill span:first-child')).map(s => s.textContent)
    };
    await chrome.storage.sync.set(saveCfg);
    alert('Saved');
  });

  els.reset.addEventListener('click', async () => {
    await chrome.storage.sync.set(DEFAULTS);
    location.reload();
  });
}

document.addEventListener('DOMContentLoaded', load);

