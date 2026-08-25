'use strict';

const UPDATED_AT = '2026年8月19日';
const APP_NAME = '炉网';
const SUPPORT_PATH = '微信小程序右上角“...”中的反馈与投诉，或通过炉网社群联系运营者';

const DOCUMENTS = Object.freeze({
  privacy: {
    title: '隐私政策',
    subtitle: '说明我们如何收集、使用、保存和删除你的信息',
    sections: [
      {
        heading: '我们收集的信息',
        body: [
          '当你使用关注、提醒、我的资料等功能时，我们会收集微信静默登录产生的用户标识、你主动选择的头像、填写的昵称、授权取得的手机号及手机号掩码。',
          '当你浏览比分、赛程、签表、球员和赛事信息时，我们会处理必要的访问请求信息、设备网络状态、接口错误日志和基础使用状态，用于保障服务稳定。'
        ]
      },
      {
        heading: '使用目的',
        body: [
          '用户标识用于建立你的炉网账号登录态，保持关注列表、比赛提醒、赛事关注和球员关注同步。',
          '头像和昵称用于个人中心展示，以及后续需要向你确认账号身份的场景。',
          '手机号用于账号绑定、关注同步、防止误操作和必要的服务通知身份确认，不会用于广告营销。'
        ]
      },
      {
        heading: '保存方式与期限',
        body: [
          '你的资料保存在炉网后端数据库中，传输过程使用 HTTPS；小程序本地会缓存头像、昵称和手机号掩码，用于减少重复请求。',
          '我们仅在实现上述功能所必需的期间保存信息。你注销账号或要求删除后，我们会删除或匿名化个人资料、关注记录和登录态；依法需要留存的安全日志会在必要期限内保存。'
        ]
      },
      {
        heading: '第三方服务',
        body: [
          '微信开放平台提供登录、头像昵称填写、手机号快速验证和隐私协议展示能力。手机号授权后，由炉网后端使用一次性 code 向微信接口换取手机号。',
          '云服务器、数据库、域名与网络服务用于运行炉网接口。网球比分、赛程、签表和球员资料来自赛事数据服务商或公开数据源，这些来源不接收你的手机号、头像或昵称。'
        ]
      },
      {
        heading: '你的权利与注销路径',
        body: [
          '你可以在“我的”页面查看《隐私政策》和《用户协议》，也可以在完善资料弹窗中再次查看。',
          `如需更正、删除个人信息或注销账号，请通过${SUPPORT_PATH}提交请求。我们会在核验身份后处理，注销后将停止为该账号提供关注同步和提醒能力。`
        ]
      },
      {
        heading: '授权前提示',
        body: [
          '在请求头像、昵称、手机号前，我们会展示收集目的和协议链接，并要求你主动确认已阅读并同意，不会使用默认勾选代替你的同意。',
          '你可以拒绝授权。拒绝后仍可浏览比分、赛程、签表和球员信息，但无法使用需要账号资料的关注同步功能。'
        ]
      }
    ]
  },
  terms: {
    title: '用户协议',
    subtitle: '说明炉网服务范围、账号规则和双方责任',
    sections: [
      {
        heading: '服务内容',
        body: [
          `${APP_NAME}提供网球比分、赛程、签表、球员、赛事和关注提醒等信息服务。数据会尽力保持准确和及时，但比赛信息可能因官方调整、数据源延迟或网络异常发生变化。`,
          '页面展示内容仅供网球观赛和信息查询使用，不构成投注、投资、医疗、法律或其他专业建议。'
        ]
      },
      {
        heading: '账号与授权',
        body: [
          '你可以在未完善资料的情况下浏览公开内容。使用关注、提醒、个人资料同步等功能时，需要通过微信登录并主动授权必要信息。',
          '你应确保填写或选择的昵称、头像不侵犯他人权益，不包含违法、冒用、攻击性或误导性内容。'
        ]
      },
      {
        heading: '用户行为',
        body: [
          '不得通过爬取、攻击、刷量、绕过限制、干扰实时更新等方式影响炉网服务或其他用户体验。',
          '不得利用炉网发布违法违规内容，或将炉网数据用于未经授权的商业再分发。'
        ]
      },
      {
        heading: '数据与变更',
        body: [
          '比赛数据、球员资料、签表和赛历可能会根据数据源、官方公告、人工修正和产品规则进行更新。',
          '我们可能基于功能改进、合规要求或服务稳定性更新本协议。重大变更会在小程序内以明显方式提示。'
        ]
      },
      {
        heading: '终止与注销',
        body: [
          `你可以通过${SUPPORT_PATH}申请注销账号或删除个人资料。注销完成后，关注、提醒和个人资料同步将不可继续使用。`,
          '如账号存在明显违法违规、攻击系统或严重影响服务稳定的行为，我们可能暂停或终止相关服务。'
        ]
      }
    ]
  }
});

function currentDocument(type) {
  return DOCUMENTS[type] || DOCUMENTS.privacy;
}

Page({
  data: {
    topInset: 44,
    type: 'privacy',
    updatedAt: UPDATED_AT,
    doc: currentDocument('privacy')
  },
  onLoad(options = {}) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const type = options.type === 'terms' ? 'terms' : 'privacy';
    const doc = currentDocument(type);
    this.setData({
      topInset: info.statusBarHeight || 44,
      type,
      doc
    });
    wx.setNavigationBarTitle?.({ title: doc.title });
  },
  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.redirectTo({ url: '/pages/account/index' });
  },
  openWechatPrivacyContract() {
    if (!wx.openPrivacyContract) return;
    wx.openPrivacyContract({ fail: () => undefined });
  },
  noop() {}
});
