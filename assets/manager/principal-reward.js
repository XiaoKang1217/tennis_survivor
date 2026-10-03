var MANAGER_PRINCIPAL_REWARD_USER = '';
var MANAGER_PRINCIPAL_REWARD_EPOCH = 0;

function managerResetPrincipalRewardNotice() {
  MANAGER_PRINCIPAL_REWARD_USER = '';
  MANAGER_PRINCIPAL_REWARD_EPOCH++;
  var modal = document.getElementById('manager-principal-reward');
  if (modal) modal.remove();
}

async function managerLoadPrincipalRewardNotice() {
  var userId = AUTH_USER && AUTH_USER.id;
  if (!userId || MANAGER_PRINCIPAL_REWARD_USER === userId) return;
  MANAGER_PRINCIPAL_REWARD_USER = userId;
  var epoch = MANAGER_PRINCIPAL_REWARD_EPOCH;
  try {
    var notice = await supabaseRpc('tour_manager_get_principal_reward_notice', {});
    if (epoch !== MANAGER_PRINCIPAL_REWARD_EPOCH || !AUTH_USER || AUTH_USER.id !== userId) return;
    if (!notice || !notice.message) return;
    managerShowPrincipalRewardNotice(notice, userId, epoch);
  } catch (_err) {
    if (epoch === MANAGER_PRINCIPAL_REWARD_EPOCH) MANAGER_PRINCIPAL_REWARD_USER = '';
  }
}

function managerShowPrincipalRewardNotice(notice, userId, epoch) {
  if (document.getElementById('manager-principal-reward')) return;
  if (!document.getElementById('manager-principal-reward-style')) {
    var style = document.createElement('style');
    style.id = 'manager-principal-reward-style';
    style.textContent = '#manager-principal-reward{box-sizing:border-box;width:calc(100% - 32px);max-width:500px;max-height:80vh;max-height:80dvh;overflow:auto;margin:auto;padding:24px;border:1px solid var(--site-border,#dedede);border-radius:8px;background:var(--site-surface,#fff);color:var(--site-text,#333);box-shadow:0 20px 60px #0004}' +
      '#manager-principal-reward::backdrop{background:#0007}' +
      '#manager-principal-reward h3{margin:0 0 16px;font-size:20px;line-height:1.4;color:inherit}' +
      '#manager-principal-reward p{font-size:16px;line-height:1.8;margin:0 0 20px;overflow-wrap:anywhere}' +
      '#manager-principal-reward footer{display:flex;justify-content:flex-end}' +
      '#manager-principal-reward button{display:inline-block;visibility:visible;opacity:1;max-width:100%;min-height:44px;padding:10px 18px;border:1px solid var(--site-border,#777);border-radius:6px;background:var(--site-accent-deep,#444);color:var(--site-on-accent,#fff);font-size:15px;line-height:1.4;cursor:pointer}' +
      '#manager-principal-reward button:disabled{opacity:.65;cursor:wait}' +
      '#manager-principal-reward .reward-error{color:var(--site-danger,#a32);font-size:14px}';
    document.head.appendChild(style);
  }
  var modal = document.createElement('dialog');
  modal.id = 'manager-principal-reward';
  modal.setAttribute('aria-labelledby', 'manager-principal-reward-title');
  modal.setAttribute('aria-describedby', 'manager-principal-reward-copy');
  modal.innerHTML = '<h3 id="manager-principal-reward-title">还愿本金已到账</h3><p id="manager-principal-reward-copy"></p><p class="reward-error" role="alert" hidden></p><footer><button type="button" autofocus>确认并关闭</button></footer>';
  modal.querySelector('#manager-principal-reward-title').textContent = notice.title || '还愿本金已到账';
  modal.querySelector('#manager-principal-reward-copy').textContent = notice.message;
  modal.addEventListener('cancel', function(event) { event.preventDefault(); });
  var button = modal.querySelector('button');
  button.addEventListener('click', async function() {
    if (button.disabled) return;
    if (epoch !== MANAGER_PRINCIPAL_REWARD_EPOCH || !AUTH_USER || AUTH_USER.id !== userId) {
      modal.remove();
      return;
    }
    button.disabled = true;
    modal.querySelector('.reward-error').hidden = true;
    try {
      var acknowledged = await supabaseRpc('tour_manager_ack_principal_reward_notice', {p_notice_id: notice.id});
      if (acknowledged !== true) throw new Error('acknowledgment_failed');
      modal.close();
      modal.remove();
      if (epoch === MANAGER_PRINCIPAL_REWARD_EPOCH && AUTH_USER && AUTH_USER.id === userId) {
        MANAGER_PRINCIPAL_REWARD_USER = '';
        await managerLoadPrincipalRewardNotice();
      }
    } catch (_err) {
      button.disabled = false;
      var error = modal.querySelector('.reward-error');
      error.textContent = '确认未成功，请检查网络后重试。';
      error.hidden = false;
    }
  });
  document.body.appendChild(modal);
  modal.showModal();
}
