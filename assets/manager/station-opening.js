var MANAGER_OPENING_NOTICE_USER = '';
var MANAGER_OPENING_NOTICE_EPOCH = 0;
var MANAGER_OPENING_NOTICE_TIMER = null;

function managerResetOpeningNotice() {
  MANAGER_OPENING_NOTICE_USER = '';
  MANAGER_OPENING_NOTICE_EPOCH++;
  clearTimeout(MANAGER_OPENING_NOTICE_TIMER);
  var modal = document.getElementById('manager-opening-notice');
  if (modal) modal.remove();
}

async function managerLoadOpeningNotice() {
  var userId = AUTH_USER && AUTH_USER.id;
  if (!userId || managerLocalSimulationMode() || MANAGER_OPENING_NOTICE_USER === userId) return;
  if (!MANAGER_ACTIVE_EVENTS || MANAGER_ACTIVE_EVENTS.station_key !== '2026-w41-shanghai') return;
  if (Date.now() >= Date.parse('2026-10-07T11:45:00+08:00')) return;
  if (document.hidden || document.querySelector('dialog[open]') || MANAGER_DIALOG || MANAGER_BADGE_GRANT_NOTICE) {
    clearTimeout(MANAGER_OPENING_NOTICE_TIMER);
    MANAGER_OPENING_NOTICE_TIMER = setTimeout(managerLoadOpeningNotice, 1500);
    return;
  }
  MANAGER_OPENING_NOTICE_USER = userId;
  var epoch = MANAGER_OPENING_NOTICE_EPOCH;
  try {
    var notice = await supabaseRpc('tour_manager_take_shanghai_opening_notice', {});
    if (epoch !== MANAGER_OPENING_NOTICE_EPOCH || !AUTH_USER || AUTH_USER.id !== userId) return;
    if (notice && notice.message) managerShowOpeningNotice(notice);
  } catch (_err) {
    if (epoch === MANAGER_OPENING_NOTICE_EPOCH) MANAGER_OPENING_NOTICE_USER = '';
  }
}

function managerShowOpeningNotice(notice) {
  if (document.getElementById('manager-opening-notice')) return;
  if (!document.getElementById('manager-opening-notice-style')) {
    var style = document.createElement('style');
    style.id = 'manager-opening-notice-style';
    style.textContent = '#manager-opening-notice{box-sizing:border-box;width:calc(100% - 32px);max-width:480px;max-height:80vh;overflow:auto;margin:auto;padding:24px;border:1px solid var(--site-border,#ddd);border-radius:8px;background:var(--site-surface,#fff);color:var(--site-text,#333);box-shadow:0 20px 60px #0004}' +
      '#manager-opening-notice::backdrop{background:#0007}' +
      '#manager-opening-notice p{font-size:17px;font-weight:600;line-height:1.8;margin:0 0 24px;overflow-wrap:anywhere}' +
      '#manager-opening-notice footer{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:12px}' +
      '#manager-opening-notice button{display:inline-block;visibility:visible;opacity:1;min-height:44px;padding:10px 16px;border:1px solid var(--site-border,#777);border-radius:6px;background:var(--site-accent-deep,#444);color:var(--site-on-accent,#fff);font-size:15px;line-height:1.4;cursor:pointer}' +
      '#manager-opening-notice button:last-child{background:var(--site-surface,#fff);color:var(--site-text,#333)}';
    document.head.appendChild(style);
  }
  var modal = document.createElement('dialog');
  modal.id = 'manager-opening-notice';
  modal.setAttribute('aria-label', '上海站开售');
  modal.innerHTML = '<p></p><footer><button type="button" autofocus>好的</button><button type="button">不了，谢谢</button></footer>';
  modal.querySelector('p').textContent = notice.message;
  modal.querySelectorAll('button').forEach(function(button) {
    button.addEventListener('click', function() { modal.close(); modal.remove(); });
  });
  modal.addEventListener('cancel', function(event) { event.preventDefault(); modal.close(); modal.remove(); });
  document.body.appendChild(modal);
  modal.showModal();
}
