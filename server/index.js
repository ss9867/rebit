import './platform.js';
import { ensureFirstOperator } from './auth.js';
import { createServer } from './app.js';

const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || '127.0.0.1';

const first = ensureFirstOperator();
if (first) {
  console.log('────────────────────────────────────────');
  console.log(' 운영자 계정을 만들었습니다.');
  console.log(`  아이디: ${first.loginId}`);
  console.log(`  비밀번호: ${first.fromEnv ? '(ADMIN_PASSWORD 값)' : first.password}`);
  console.log(' 로그인 후 [계정] 메뉴에서 비밀번호를 바꿔 주세요.');
  console.log('────────────────────────────────────────');
}

createServer().listen(port, host, () => {
  console.log(`rebit 쇼핑몰: http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`);
  console.log(`운영자 화면: http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/admin`);
});
