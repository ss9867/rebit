import './platform.js';
// 운영자 계정을 새로 만들거나, 비밀번호를 잊었을 때 임시 비밀번호로 바꾼다.
// 사용법: npm run admin -- <아이디> [이름]
import { createOperator, hashPassword, tempPassword } from './auth.js';
import { get, run } from './db.js';

const [loginId, name = '운영자'] = process.argv.slice(2);
if (!loginId || !/^[a-zA-Z0-9_.-]{3,30}$/.test(loginId)) {
  console.log('사용법: npm run admin -- <아이디(영문·숫자 3~30자)> [이름]');
  process.exit(1);
}
const password = tempPassword();
const row = get('SELECT id FROM operators WHERE login_id = ?', loginId);
if (row) {
  run('UPDATE operators SET pw_hash = ? WHERE id = ?', hashPassword(password), row.id);
  run('DELETE FROM sessions WHERE operator_id = ?', row.id);
  console.log(`${loginId} 계정의 비밀번호를 바꿨습니다.`);
} else {
  createOperator(loginId, name, password);
  console.log(`운영자 계정 ${loginId}을(를) 만들었습니다.`);
}
console.log(`임시 비밀번호: ${password}`);
