// 위젯 창용: 위젯 페이지가 PC 기능(알림, 창 조절)을 부를 수 있게 한다
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desk', {
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  widget: (act, val) => ipcRenderer.send('widget', act, val),
  onView: fn => ipcRenderer.on('view', (_e, view) => fn(view)),
});
