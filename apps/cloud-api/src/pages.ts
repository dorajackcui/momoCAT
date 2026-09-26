// Small, same-origin login/approval surface. No third-party assets or analytics.
export function devicePage(): Response {
  const nonce = crypto.randomUUID();
  return new Response(
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>momoCAT Cloud</title>
<style nonce="${nonce}">body{font:16px system-ui;background:#f5f5f4;color:#242424;max-width:520px;margin:12vh auto;padding:24px}main{background:white;padding:36px;border-radius:16px}button,input{font:inherit;padding:12px;margin:8px 0;width:100%;box-sizing:border-box}button{cursor:pointer}#code{font:28px monospace;letter-spacing:4px}p{line-height:1.7}#status{white-space:pre-wrap}</style>
<main><h1>momoCAT Cloud</h1><p>将当前电脑连接到你的云项目。</p>
<p id="identity"></p><label for="user-code">桌面端显示的设备验证码</label><input id="user-code" autocomplete="off" maxlength="12">
<button id="login" hidden>使用 GitHub 登录</button><button id="verify" hidden>检查验证码</button>
<section id="approval" hidden><p>请确认此验证码与你刚刚发起登录的 momoCAT 客户端一致。</p><p id="code"></p><p>允许这台设备访问和保存你的 momoCAT 云项目。登录有效期最长 7 天。</p><button id="approve">允许这台设备</button><button id="deny">拒绝</button></section>
<p id="status" role="status"></p></main>
<script nonce="${nonce}">
const el=id=>document.getElementById(id);let verifiedCode='';
el('user-code').value=new URLSearchParams(location.search).get('user_code')||'';
async function api(path,body){const r=await fetch('/api/auth/'+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const d=await r.json();if(!r.ok)throw Error(d.message||d.error_description||'请求未完成，请重试');return d}
function showError(e){el('status').textContent=e.message}
el('login').onclick=async()=>{try{const url='/device?user_code='+encodeURIComponent(el('user-code').value);const d=await api('sign-in/social',{provider:'github',callbackURL:url});const next=new URL(d.url);if(next.protocol!=='https:'||next.hostname!=='github.com')throw Error('登录地址无效');location.assign(next.href)}catch(e){showError(e)}};
el('verify').onclick=async()=>{try{verifiedCode=el('user-code').value.trim();await api('device?user_code='+encodeURIComponent(verifiedCode));el('code').textContent=verifiedCode;el('approval').hidden=false;el('status').textContent='';}catch(e){showError(e)}};
for(const action of ['approve','deny'])el(action).onclick=async()=>{try{await api('device/'+action,{userCode:verifiedCode});el('approval').hidden=true;el('verify').hidden=true;el('status').textContent=action==='approve'?'已连接。请返回 momoCAT。':'已拒绝此次连接。'}catch(e){showError(e)}};
api('get-session').then(s=>{const ok=!!s?.user;el('login').hidden=ok;el('verify').hidden=!ok;el('identity').textContent=ok?'已登录：'+s.user.email:'请先登录你的受邀账号。'}).catch(showError);
</script></html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}
