// 호스팅 업체가 넣어 주는 환경변수를 보고 기본값을 채운다. 다른 서버 파일보다 먼저 import해야 한다.
// 직접 넣은 환경변수가 있으면 그 값을 그대로 쓴다.
const env = process.env;

// Railway: 외부에서 접속할 수 있게 0.0.0.0에서 듣고, HTTPS 프록시 뒤라 보안 쿠키와 프록시 IP를 켠다.
// 저장 공간(Volume)을 붙였으면 DB를 그 안에 둔다. 붙이지 않으면 배포할 때마다 상담 기록이 지워진다.
if (env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT) {
  env.HOST ??= '0.0.0.0';
  env.NODE_ENV ??= 'production';
  env.TRUST_PROXY ??= '1';
  if (env.RAILWAY_VOLUME_MOUNT_PATH) env.REBIT_DATA_DIR ??= env.RAILWAY_VOLUME_MOUNT_PATH;
  else console.warn('주의: Railway 저장 공간(Volume)이 없어요. 다시 배포하면 상담 기록과 운영자 계정이 초기화됩니다.');
}
