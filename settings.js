document.addEventListener('DOMContentLoaded', function() {
  const saveBtn = document.getElementById('saveBtn');
  const status = document.getElementById('status');
  
  // Load existing settings
  chrome.storage.sync.get(['apiKeys'], (result) => {
    const keys = result.apiKeys || {};
    
    document.getElementById('googleApiKey').value = keys.google?.apiKey || '';
    document.getElementById('googleCx').value = keys.google?.cx || '';
    document.getElementById('serpapiKey').value = keys.serpapi || '';
    document.getElementById('braveKey').value = keys.brave || '';
  });
  
  saveBtn.addEventListener('click', () => {
    const apiKeys = {
      google: {
        apiKey: document.getElementById('googleApiKey').value.trim(),
        cx: document.getElementById('googleCx').value.trim()
      },
      serpapi: document.getElementById('serpapiKey').value.trim(),
      brave: document.getElementById('braveKey').value.trim()
    };
    
    chrome.storage.sync.set({ apiKeys }, () => {
      status.textContent = '✅ Settings saved successfully!';
      status.className = 'status success';
      
      setTimeout(() => {
        status.textContent = '';
      }, 3000);
    });
  });
});
