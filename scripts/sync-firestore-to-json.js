/**
 * scripts/sync-firestore-to-json.js
 * ------------------------------------------------------------
 * Firestore의 'lifesavers' 컬렉션을 읽어서 lifesavers.json 파일로 저장합니다.
 * ⚠️ 매번 전체를 다시 읽지 않고, "마지막 동기화 이후 바뀐 문서만" 읽어옵니다.
 *    (updatedAt 필드 기준) — 그래야 자주 돌려도 무료 읽기 한도(하루 5만 회)를 안 넘음.
 *
 * 최초 1회만 전체를 읽고, 그 다음부터는 lifesavers.json 옆에 저장해두는
 * .sync-state.json의 마지막 동기화 시각 이후 변경분만 가져옵니다.
 */
const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const DATA_FILE = 'lifesavers_full.json'; // id 포함 전체 캐시(내부 관리용)
const OUTPUT_FILE = 'lifesavers.json';    // 앱이 실제로 읽는 파일(원래 형식 그대로: [{lat,lng,addr,note}])
const STATE_FILE = '.sync-state.json';

async function main(){
  let byId = {};
  let lastSync = 0;
  if(fs.existsSync(DATA_FILE)) byId = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if(fs.existsSync(STATE_FILE)) lastSync = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).lastSync || 0;

  const isFirstRun = Object.keys(byId).length === 0;
  let snapshot;
  if(isFirstRun){
    console.log('최초 실행 — 전체 컬렉션을 한 번만 읽습니다.');
    snapshot = await db.collection('lifesavers').get();
  } else {
    console.log(`증분 동기화 — ${new Date(lastSync).toISOString()} 이후 변경분만 읽습니다.`);
    snapshot = await db.collection('lifesavers').where('updatedAt', '>', lastSync).get();
  }

  console.log(`이번에 읽은 문서 수: ${snapshot.size}건`);
  snapshot.forEach(doc=>{
    byId[doc.id] = doc.data();
  });

  // 삭제된 문서 처리: 매번 전체를 지우고 다시 채우면 안 되므로,
  // 변경분 조회만으로는 "삭제"를 알 수 없음 — 하루 한 번(최초 실행이 아닐 때, 0시~1시 사이)만
  // 전체를 다시 읽어 정합성을 맞춤(그래도 하루 1번이라 읽기 부담 거의 없음).
  const hourUTC = new Date().getUTCHours();
  if(!isFirstRun && hourUTC === 0){
    console.log('일일 정합성 체크 — 전체 컬렉션을 다시 읽어 삭제된 문서를 반영합니다.');
    const full = await db.collection('lifesavers').get();
    byId = {};
    full.forEach(doc=>{ byId[doc.id] = doc.data(); });
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(byId));
  fs.writeFileSync(STATE_FILE, JSON.stringify({ lastSync: Date.now() }));

  const output = Object.values(byId).map(d=>({ lat:d.lat, lng:d.lng, addr:d.addr||'', note:d.note||'' }));
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output));
  console.log(`동기화 완료: 총 ${output.length}건을 ${OUTPUT_FILE}에 저장했습니다.`);
}

main().catch(err=>{
  console.error('동기화 실패:', err);
  process.exit(1);
});
