const DEFAULTS = {
  apiKeys: {
    brave: '',
    googleImages: {
      apiKey: '',
      cx: ''
    }
  },
  searchConfig: {
    imgSize: 'xxlarge',
    minWidth: 2000,
    minHeight: 2000,
    minBytes: 1500000,
    exactDefault: true
  },
  blacklist: [
    'facebook.com','instagram.com','x.com','twitter.com','tiktok.com','pinterest.com','reddit.com',
    'youtube.com','youtu.be','wikipedia.org','wikimedia.org','wikiquote.org','fandom.com','wikia.com','quora.com','linkedin.com'
  ]
};

function getEls() {
  return {
    braveApiKey: document.getElementById('braveApiKey'),
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
  
  // Load settings using the same structure as BSettings.js
  const stored = await chrome.storage.sync.get(['apiKeys', 'searchConfig', 'blacklist']);
  
  // Merge with defaults
  const mergedApiKeys = {
    ...DEFAULTS.apiKeys,
    ...stored.apiKeys,
    googleImages: {
      ...DEFAULTS.apiKeys.googleImages,
      ...stored.apiKeys?.googleImages
    }
  };
  
  const mergedSearchConfig = {
    ...DEFAULTS.searchConfig,
    ...stored.searchConfig
  };
  
  const mergedBlacklist = stored.blacklist || DEFAULTS.blacklist;
  
  // Populate form fields
  els.braveApiKey.value = mergedApiKeys.brave || '';
  els.apiKey.value = mergedApiKeys.googleImages.apiKey || '';
  els.cx.value = mergedApiKeys.googleImages.cx || '';
  els.imgSize.value = mergedSearchConfig.imgSize || 'xxlarge';
  els.minWidth.value = mergedSearchConfig.minWidth || 2000;
  els.minHeight.value = mergedSearchConfig.minHeight || 2000;
  els.minBytes.value = mergedSearchConfig.minBytes || 1500000;
  els.exactDefault.checked = mergedSearchConfig.exactDefault !== false;
  renderBlacklist(els.blacklist, mergedBlacklist);

  els.addBtn.addEventListener('click', () => {
    const d = els.addDomain.value.trim();
    if (!d) return;
    mergedBlacklist.push(d);
    els.addDomain.value = '';
    renderBlacklist(els.blacklist, mergedBlacklist);
  });

  els.save.addEventListener('click', async () => {
    const saveCfg = {
      apiKeys: {
        brave: els.braveApiKey.value.trim(),
        googleImages: {
          apiKey: els.apiKey.value.trim(),
          cx: els.cx.value.trim()
        }
      },
      searchConfig: {
        imgSize: els.imgSize.value,
        minWidth: Number(els.minWidth.value),
        minHeight: Number(els.minHeight.value),
        minBytes: Number(els.minBytes.value),
        exactDefault: els.exactDefault.checked
      },
      blacklist: Array.from(els.blacklist.querySelectorAll('.pill span:first-child')).map(s => s.textContent)
    };
    
    await chrome.storage.sync.set(saveCfg);
    console.log('[Options] Settings saved:', {
      brave: saveCfg.apiKeys.brave ? 'SET' : 'EMPTY',
      google: saveCfg.apiKeys.googleImages.apiKey ? 'SET' : 'EMPTY'
    });
    alert('Saved');
  });

  els.reset.addEventListener('click', async () => {
    await chrome.storage.sync.set(DEFAULTS);
    location.reload();
  });
}

document.addEventListener('DOMContentLoaded', load);

