const { ipcRenderer } = require('electron');
ipcRenderer.on('leave', () => document.body.classList.add('leave'));
