export type LegalDocumentId = 'privacy' | 'terms'
type Section = { title: string; paragraphs: string[]; links?: { label: string; href: string }[] }
type LegalDocument = { title: string; english: string; summary: string; sections: Section[] }

export const legalUpdatedAt = '2026-11-11'
export const legalDocuments: Record<LegalDocumentId, LegalDocument> = {
  privacy: {
    title: '隐私权政策', english: 'PRIVACY POLICY',
    summary: '以本地存储为基础，由你决定何时连接外部服务、备份和恢复数据。',
    sections: [
      { title: '适用范围与提供者', paragraphs: ['丝月工坊（Sylunae Workshop）由项目维护者 sylunae 提供，是集收藏、图片、音乐、笔记、任务与实用工具于一体的个人工具站。本政策适用于 Web、Windows 桌面端和 Android 客户端，以及可选的 Google Drive 备份与恢复功能。'] },
      { title: '本地数据与使用目的', paragraphs: ['你创建或导入的笔记、日记、任务、收藏、图片、音乐索引、剪贴板片段、资源和应用偏好用于提供对应功能。Web 版主要保存在当前浏览器的 IndexedDB 与本地存储中；Windows 和 Android 客户端使用本地数据库、文件与应用目录。媒体原件可能保留在你选择的路径或应用目录中。', '应用不要求注册丝月工坊账号。当前版本不内置广告、行为分析或向开发者自动上传个人内容的遥测服务。本地保存不等于云端备份；浏览器数据清理、卸载、磁盘损坏或文件移动都可能影响可用性。'] },
      { title: 'Google 数据的访问与用途', paragraphs: ['Google Drive 为可选功能，只有你主动连接并授权后才会访问。当前仅请求 https://www.googleapis.com/auth/drive.appdata 权限，用于访问此应用在你的 Google Drive 中的隐藏应用专用空间，不读取普通云盘文件、Gmail 或通讯录。', '应用通过 Drive API 获取账号标识、邮箱或显示名称，用于显示并核对连接的账号；Windows 端还读取存储配额以检查备份空间。备份清单包含设备名称、备份时间、内容数量和文件校验信息。', 'Windows 端在你确认备份后，将应用数据及相关媒体原件（例如笔记附件、精选图片、音乐和自定义白噪音）直接上传到你的 Google Drive。Android 端在你确认恢复后，下载备份、校验文件并写入本机。当前提供手动备份与恢复，不进行持续云端同步。授权凭据和桌面 OAuth 客户端配置不作为普通业务数据随备份上传。'] },
      { title: '授权凭据与安全', paragraphs: ['Windows 通过系统浏览器完成 Google OAuth 授权，并使用系统提供的 Electron safeStorage 加密保存桌面 OAuth 配置和刷新凭据；访问令牌在运行时使用。Android 通过 Google Play 服务授权，访问令牌在运行时使用，账号标识与显示信息保存在应用私有偏好中。应用不会索取或保存你的 Google 密码。', '与 Google API 的通信使用 HTTPS。云端备份保存在你的 Google 账号下，不经过开发者自建的备份服务器。当前备份未额外提供由用户密钥控制的端到端加密；本地业务数据也不保证全部加密，请妥善保护设备、系统账号与 Google 账号。'] },
      { title: '第三方服务与数据共享', paragraphs: ['使用 Bangumi 时会发送你填写的公开用户名并获取公开收藏与封面；天气查询会向 Open-Meteo 发送搜索词或选定城市的经纬度；RSS、外部图片、字体、资源下载、YouTube 导入和更新检查会连接对应内容提供方或 GitHub 等分发服务。第三方会收到完成请求所需的信息，包括 IP 地址与请求元数据，并按其自身政策处理。使用音乐工具箱时可能加载团子 AI 页面；在该页面内选择的文件或提交的信息由该第三方工具处理。', '应用不会将 Google 用户数据出售、用于广告、信用评估或通用 AI／机器学习模型训练，也不会允许开发者日常人工阅读你的 Google 数据。Google 数据仅用于你请求的备份、恢复和相关账号、配额展示。你主动导出文件、分享内容或提交反馈时，请自行确认其中的信息；依法必须披露或你明确同意的处理，以适用法律和相应授权为限。', '丝月工坊对从 Google API 收到的信息的使用及向其他应用的转移，遵守 Google API Services User Data Policy，包括 Limited Use 要求。'], links: [{ label: 'Google API Services User Data Policy', href: 'https://developers.google.com/terms/api-services-user-data-policy' }, { label: 'Google 隐私权政策', href: 'https://policies.google.com/privacy' }] },
      { title: '保存期限、撤销与删除', paragraphs: ['本地数据保留到你删除对应内容、清理站点数据或移除应用数据为止；回收站、缓存、恢复回退副本、手动导出文件和应用目录之外的媒体可能需要另行清理。删除应用内的一条内容，不会自动删除已导出的文件或历史云端备份。', '可在「设置 → 数据与备份 → Google Drive 备份」断开连接。此操作停止本机连接并清除相应本机授权状态，不等同于在 Google 账号中撤销授权，也不会删除云端备份。你可以在 Google 账号的第三方连接管理中撤销访问权限。', '云端历史备份与上传文件目前保留，应用暂不提供逐份删除界面。要删除云端应用数据，请在 Google Drive 网页的「设置 → 管理应用」中找到丝月工坊，使用删除隐藏应用数据的选项（具体名称以 Google 界面为准）。撤销授权、断开连接或卸载客户端本身不应被视为已经完成云端数据删除。'], links: [{ label: '管理 Google 账号的第三方连接', href: 'https://myaccount.google.com/connections' }, { label: '打开 Google Drive 设置', href: 'https://drive.google.com/drive/u/0/settings' }] },
      { title: '你的选择与未成年人', paragraphs: ['你可以不连接 Google 或其他可选服务而继续使用相应的本地功能，并通过应用的导出与备份功能取得可用副本。涉及本地文件、通知等权限时，由系统权限和你的操作决定是否允许。', '本应用不以未成年人为特定服务对象，也不会主动要求提供年龄信息。未成年人应在监护人指导下使用第三方账号与联网功能。'] },
      { title: '政策更新与联系', paragraphs: ['功能或数据处理方式发生变化时，我们会更新本页面及更新日期。新增 Google 数据用途前会更新披露，并在需要时重新征求授权。隐私问题或数据处理请求可通过项目反馈入口联系维护者；请勿在公开 Issue 中粘贴令牌、OAuth JSON、私人备份或其他敏感数据。'], links: [{ label: '联系维护者 · 项目反馈', href: 'https://github.com/sylunae/sylunae-workshop/issues' }] },
    ],
  },
  terms: {
    title: '应用服务条款', english: 'TERMS OF SERVICE',
    summary: '关于使用丝月工坊、本地内容管理与可选联网功能的约定。',
    sections: [
      { title: '条款的适用', paragraphs: ['丝月工坊（Sylunae Workshop）由项目维护者 sylunae 提供。本条款适用于应用的 Web、Windows 和 Android 版本。开始使用前，请阅读本条款和隐私权政策；如不同意，请停止使用相关服务。未成年人应在监护人指导下使用。'] },
      { title: '服务内容与平台差异', paragraphs: ['丝月工坊提供收藏管理、图片浏览、音乐与白噪音、笔记、任务及其他实用工具。不同平台的功能取决于系统权限和可用能力；本地媒体、下载工具、后台播放等功能可能有平台限制。', 'Google Drive 为你主动选择的第三方备份渠道。当前支持 Windows 手动上传备份和 Android 手动恢复，并非实时同步或托管存储服务。备份与恢复须使用可访问同一项目应用专用空间的 Google 账号及有效授权。'] },
      { title: '你的内容与合法使用', paragraphs: ['你保留自己创建或合法持有内容的权利。本条款不将你的笔记、图片、音乐或其他私人内容转让给维护者。为执行你的操作，应用会在本地或你授权的云盘中读取、缓存、转换、复制和保存相关内容。', '请仅导入、下载和分享你有权使用的内容，遵守适用法律、著作权及第三方平台规则。不得利用应用侵犯隐私、传播违法内容、盗取凭据、绕过访问控制或干扰他人服务。应用中的第三方作品、商标与媒体归其各自权利人所有。'] },
      { title: '账号、授权与第三方服务', paragraphs: ['请妥善保管设备、Google 账号、OAuth 客户端配置和授权凭据。你可随时停止可选服务、断开连接或向第三方撤销授权；这可能使备份、恢复等相关功能不可用。', 'Bangumi、Google Drive、Open-Meteo、RSS 来源、媒体与资源提供方等服务由第三方运营，并适用各自的条款、隐私政策、配额和收费规则。第三方接口调整、账号限制、网络或服务中断可能影响功能。维护者不承诺第三方服务持续可用。'], links: [{ label: 'Google 服务条款', href: 'https://policies.google.com/terms' }] },
      { title: '备份、恢复与数据责任', paragraphs: ['请为重要内容保留独立、可验证的备份。执行导入、恢复、删除、清理缓存或卸载前，请阅读界面提示并核对来源、账号与数据范围。普通 JSON 导出与 Google Drive 备份覆盖的媒体范围不同，以具体功能说明为准。', '恢复可能替换对应的本地数据。移动原文件、磁盘故障、浏览器数据清理、存储空间不足、授权失效、云端配额或备份损坏都可能导致内容不可用。回退机制不替代长期备份，也不保证覆盖所有故障。断开连接、撤销授权与删除云端数据是不同操作，删除方式见隐私权政策。'] },
      { title: '可用性与责任范围', paragraphs: ['应用按当前可用状态提供，可能存在缺陷、兼容性限制或维护中断。维护者会持续改进，但不承诺应用无错误、始终在线、完全满足特定用途或永久保留所有功能。', '在适用法律允许的范围内，维护者不对因第三方故障、不可抗力、未经授权使用或未妥善备份等导致的间接损失承担责任。本条款不排除或限制适用法律不得排除的责任及用户依法享有的权利。'] },
      { title: '隐私与条款更新', paragraphs: ['个人数据和 Google 用户数据的访问、使用、保存与删除方式见隐私权政策。使用相关功能时，也请阅读界面中与该操作有关的说明。', '应用功能或本条款可能随版本更新而调整。变更会在本页面注明更新日期；对使用或数据处理有重大影响的变更，将通过应用说明等合理方式提示。你可以停止使用受影响的功能。'] },
      { title: '联系与反馈', paragraphs: ['如果你对本条款、功能或内容权利有疑问，可通过项目反馈入口联系维护者。请提供必要的版本与问题描述，并避免在公开反馈中泄露私人内容、账号凭据或备份。'], links: [{ label: '联系维护者 · 项目反馈', href: 'https://github.com/sylunae/sylunae-workshop/issues' }] },
    ],
  },
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

// Shared, escaped static markup keeps the public pages and in-app reader identical.
// Public HTML contains the entire policy even without JavaScript or app storage.
export function renderLegalDocument(id: LegalDocumentId) {
  return `<div class="legal-document">${legalDocuments[id].sections.map((section, index) =>
    `<section id="section-${index + 1}"><h2><span>${String(index + 1).padStart(2, '0')}</span>${escapeHtml(section.title)}</h2>${section.paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join('')}${section.links ? `<div class="legal-references">${section.links.map((link) => `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)} ↗</a>`).join('')}</div>` : ''}</section>`,
  ).join('')}</div>`
}

export function renderLegalPage(id: LegalDocumentId) {
  const doc = legalDocuments[id]
  return `<div class="legal-shell"><aside class="legal-sidebar"><a class="legal-brand" href="./index.html">丝月工坊<small>MY QUIET SPACE</small></a><p>收藏喜欢的内容，记录日常，<br>在一处安放音乐、笔记与任务。</p><nav aria-label="法律与隐私"><a href="./privacy.html" ${id === 'privacy' ? 'aria-current="page"' : ''}>隐私权政策</a><a href="./terms.html" ${id === 'terms' ? 'aria-current="page"' : ''}>应用服务条款</a><a href="./index.html">返回工坊 ↗</a></nav></aside><main class="legal-main"><header class="legal-heading"><span class="eyebrow">${doc.english}</span><h1>${doc.title}</h1><p>${doc.summary}</p><small>更新与生效日期：${legalUpdatedAt}</small></header>${renderLegalDocument(id)}<footer class="legal-page-footer">丝月工坊 · Sylunae Workshop</footer></main></div>`
}
