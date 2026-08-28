export const environment = {
  production: true,
  // **空字串 = 同源**。部署方式是前端與 API 掛在同一個 hostname 上
  // （Pages 服務 /，Worker route 接管 /api/*），所以不需要絕對網址。
  //
  // 同源的好處不只是少設一個值：cookie 是第一方的，SameSite 的規則完全不適用 ——
  // 跨站部署時踩過 Partitioned 打斷 OAuth state cookie 的坑。
  // 見 kb/wiki/architecture/line-oauth-login.md
  apiUrl: '',
  turnstileSiteKey: 'YOUR_TURNSTILE_SITE_KEY',
};
