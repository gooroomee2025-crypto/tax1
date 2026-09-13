const progressStore = {}; // chapterId -> {answeredCount, correctCount, done, wrongIds, completionCount, wrongCounts}

// ---------- 기기 간 동기화 (Firebase Firestore) ----------
// 아래 firebaseConfig 값을 본인 Firebase 프로젝트의 설정값으로 교체해야 동기화가 동작합니다.
// (설정 방법은 별도 안내 참고 - Firebase 콘솔에서 프로젝트 생성 후 웹 앱 추가하면 자동 생성되는 값)
const firebaseConfig = {
  apiKey: "AIzaSyDnywnqYRtltILefyFLCXhCUrDjxE5zD84",
  authDomain: "tax1-4d93d.firebaseapp.com",
  projectId: "tax1-4d93d",
  storageBucket: "tax1-4d93d.firebasestorage.app",
  messagingSenderId: "930817066034",
  appId: "1:930817066034:web:cc7f385f0efd44aea6282b"
};

let db = null;
let syncCode = localStorage.getItem('syncCode') || null;

function initFirebaseIfConfigured(){
  if(firebaseConfig.apiKey === "YOUR_API_KEY") return; // 아직 설정 안 됨
  if(typeof firebase === 'undefined') return;
  try{
    if(!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
  }catch(e){
    console.warn('Firebase 초기화 실패:', e);
  }
}

async function pullFromCloud(){
  if(!db || !syncCode) return null;
  try{
    const snap = await db.collection('syncData').doc(syncCode).get();
    return snap.exists ? snap.data() : null;
  }catch(e){
    console.warn('클라우드 불러오기 실패:', e);
    return null;
  }
}

async function pushToCloud(){
  if(!db || !syncCode) return;
  try{
    await db.collection('syncData').doc(syncCode).set({
      progress: progressStore,
      updatedAt: Date.now()
    });
  }catch(e){
    console.warn('클라우드 저장 실패:', e);
  }
}

// 앱 시작 시: 클라우드와 로컬 중 더 최신 데이터를 기준으로 맞춤
async function syncOnLoad(){
  if(!db || !syncCode) return;
  const cloudData = await pullFromCloud();
  const localUpdated = Number(localStorage.getItem('lastUpdated') || 0);
  if(cloudData && cloudData.updatedAt > localUpdated){
    Object.keys(cloudData.progress || {}).forEach(chId => {
      progressStore[chId] = Object.assign(emptyProgress(), cloudData.progress[chId]);
    });
    for(const chId of Object.keys(progressStore)){
      await saveProgress(chId, false); // 로컬 저장만, 클라우드 재전송은 안 함
    }
    localStorage.setItem('lastUpdated', String(cloudData.updatedAt));
  } else {
    await pushToCloud();
    localStorage.setItem('lastUpdated', String(Date.now()));
  }
}

async function setupSync(){
  const input = window.prompt(
    '다른 기기와 동기화할 코드를 입력하세요.\n(두 기기(갤럭시탭/폰)에서 똑같은 코드를 입력하면 서로 연동됩니다. 원하는 문자/숫자 조합 4자 이상으로 정해주세요.)',
    syncCode || ''
  );
  if(input === null) return;
  const trimmed = input.trim();
  if(trimmed.length < 4){
    alert('코드는 4자 이상으로 설정해주세요.');
    return;
  }
  syncCode = trimmed;
  localStorage.setItem('syncCode', syncCode);
  initFirebaseIfConfigured();
  if(!db){
    alert('동기화 코드는 저장됐지만 Firebase 연결 설정이 아직 안 되어 있어요.');
    updateSyncStatus();
    return;
  }
  await syncOnLoad();
  renderPartBlocks();
  updateSyncStatus();
  alert('동기화 설정이 완료되었습니다! 다른 기기에서도 같은 코드로 설정해주세요.');
}

function updateSyncStatus(){
  const el = document.getElementById('sync-status');
  if(!el) return;
  el.textContent = syncCode ? `연동 코드: ${syncCode}` : '아직 설정되지 않음';
}

function findChapter(chapterId){
  for(const part of PARTS){
    const ch = part.chapters.find(c => c.id === chapterId);
    if(ch) return { part, chapter: ch };
  }
  return null;
}

function chapterNumberPrefix(ch){
  const m = ch.name.match(/^(\d+)/);
  return m ? m[1] : ch.num;
}

function questionDisplayNo(ch, q){
  const idStr = String(q.id);
  return idStr.includes('-') ? idStr : `${chapterNumberPrefix(ch)}-${idStr}`;
}

let state = {
  queue: [],
  idx: 0,
  correct: 0,
  wrong: [],
  answered: false,
  currentChapterId: null,
  isFullRun: false,
  origin: 'home'
};

const screens = {
  home: document.getElementById('screen-home'),
  wrongnote: document.getElementById('screen-wrongnote'),
  quiz: document.getElementById('screen-quiz'),
  result: document.getElementById('screen-result'),
};

function showScreen(name){
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

function emptyProgress(){
  return { answeredCount: 0, correctCount: 0, done: false, wrongIds: [], completionCount: 0, wrongCounts: {} };
}

// 문제 id로 해당 문제가 속한 챕터를 찾는 함수 (여러 챕터가 섞인 오답 재풀이에서도 정확히 집계하기 위함)
function findChapterOfQuestion(qId){
  for(const part of PARTS){
    for(const ch of part.chapters){
      if(ch.questions.some(q => String(q.id) === String(qId))) return ch;
    }
  }
  return null;
}

// Storage Helper Functions (localStorage + window.storage Fallback)
async function getStoredData(key) {
  try {
    if (typeof window !== 'undefined' && window.storage && typeof window.storage.get === 'function') {
      const res = await window.storage.get(key, false);
      if (res && res.value) return res.value;
    }
  } catch (e) {
    console.warn(`window.storage.get 실패 (${key}), localStorage로 전환합니다:`, e);
  }
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.error(`localStorage.getItem 실패 (${key}):`, e);
    return null;
  }
}

async function setStoredData(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.error(`localStorage.setItem 실패 (${key}):`, e);
  }

  try {
    if (typeof window !== 'undefined' && window.storage && typeof window.storage.set === 'function') {
      await window.storage.set(key, value, false);
    }
  } catch (e) {
    console.warn(`window.storage.set 실패 (${key}), localStorage 저장을 유지합니다:`, e);
  }
}

async function loadAllProgress(){
  for(const part of PARTS){
    for(const ch of part.chapters){
      try{
        const val = await getStoredData('progress:' + ch.id);
        progressStore[ch.id] = val ? Object.assign(emptyProgress(), JSON.parse(val)) : emptyProgress();
      }catch(e){
        progressStore[ch.id] = emptyProgress();
      }
    }
  }
}

async function saveProgress(chapterId, pushCloud = true){
  const payload = JSON.stringify(progressStore[chapterId]);
  await setStoredData('progress:' + chapterId, payload);
  localStorage.setItem('lastUpdated', String(Date.now()));
  if(pushCloud) await pushToCloud();
}

// 오답노트에서 특정 문제를 삭제하는 함수
async function removeWrongQuestion(chapterId, questionId) {
  const p = progressStore[chapterId];
  if (!p || !p.wrongIds) return;
  
  p.wrongIds = p.wrongIds.filter(id => String(id) !== String(questionId));
  await saveProgress(chapterId);
  renderWrongNoteScreen();
}

function renderPartBlocks(){
  const wrap = document.getElementById('part-blocks');
  wrap.innerHTML = PARTS.map(part => `
    <div class="part-block">
      <div class="part-label">${part.label}</div>
      <div class="part-title">${part.name}</div>
      <div class="chapter-group">
        ${part.chapters.map(ch => {
          const p = progressStore[ch.id] || emptyProgress();
          const total = ch.questions.length;
          const displayName = ch.name.replace(/^\d+\.\s*/, '');
          const attempted = p.answeredCount > 0;
          const score = attempted ? Math.round((p.correctCount / total) * 100) : null;
          const scoreClass = score !== null && score >= 80 ? 'high' : 'low';
          const completionText = p.completionCount > 0 ? ` · 완독 ${p.completionCount}회` : '';
          return `
            <div class="chapter-card" data-chapter-id="${ch.id}">
              <div class="chapter-check">${p.done ? '✓' : ''}</div>
              <div class="chapter-info">
                <div class="chapter-num-label">CHAPTER ${ch.num}</div>
                <div class="chapter-name">${displayName}</div>
              </div>
              <div class="chapter-stat">
                ${attempted
                  ? `<div class="chapter-score ${scoreClass}">${score}점</div>`
                  : `<div class="chapter-status undone">미완료</div>`}
                <div class="chapter-count">${p.correctCount}/${total}${completionText}</div>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>
  `).join('');

  wrap.querySelectorAll('.chapter-card').forEach(card => {
    card.addEventListener('click', () => {
      const { chapter } = findChapter(card.dataset.chapterId);
      state.origin = 'home';
      startQuiz(shuffle(chapter.questions), chapter.id, true);
    });
  });
}

function renderWrongNoteScreen(){
  const wrap = document.getElementById('wrongnote-list');
  wrap.innerHTML = PARTS.map(part => {
    let totalWrong = 0;
    const chapterBlocks = part.chapters.map(ch => {
      const p = progressStore[ch.id] || emptyProgress();
      const wrongQs = (p.wrongIds || []).map(id => ch.questions.find(qq => qq.id === id)).filter(Boolean);
      if(wrongQs.length === 0) return '';
      totalWrong += wrongQs.length;
      const displayName = ch.name.replace(/^\d+\.\s*/, '');
      return `
        <div class="wrongnote-chapter">
          <div class="wrongnote-chapter-head">
            <div class="wc-title-wrap">
              <span class="wc-arrow">▼</span>
              <span class="wc-name">CHAPTER ${ch.num} · ${displayName}</span>
            </div>
            <span class="wc-count">${wrongQs.length}개</span>
          </div>
          <div class="wrongnote-chapter-body">
            ${wrongQs.map(q => {
              // wrongCounts 기록이 없는 기존 오답도 이미 최소 1회는 틀린 것이므로 1로 표시
              const wrongCount = (p.wrongCounts && p.wrongCounts[q.id]) || 1;
              return `
              <div class="wrongnote-item">
                <span class="wq-del" data-ch-id="${ch.id}" data-q-id="${q.id}">✕</span>
                <div class="wq-source">문제 #${questionDisplayNo(ch, q)} ${q.source || ''}</div>
                <div class="wq-text">${q.question}</div>
                <div class="wq-answer">정답: ${q.answer} <span class="wq-wrong-count">· 틀린 횟수 ${wrongCount}회</span></div>
              </div>
            `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');

    const body = totalWrong === 0
      ? `<div class="wrongnote-empty">저장된 문제가 없습니다</div>`
      : `
        <div class="wrongnote-summary">
          <span class="cnt">${totalWrong}개 문제 저장됨</span>
          <button class="retry" data-part="${part.key}">틀린 문제 다시 풀기</button>
        </div>
        ${chapterBlocks}
      `;

    return `
      <div class="wrongnote-part">
        <div class="part-label">${part.label}</div>
        <div class="part-title">${part.name}</div>
        ${body}
      </div>
    `;
  }).join('');

  // 챕터 헤더 클릭 시 접기/펼치기 토글 이벤트
  wrap.querySelectorAll('.wrongnote-chapter-head').forEach(head => {
    head.addEventListener('click', () => {
      const chapterEl = head.closest('.wrongnote-chapter');
      chapterEl.classList.toggle('open');
    });
  });

  // 개별 문제 삭제(✕) 버튼 이벤트
  wrap.querySelectorAll('.wq-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // 아코디언 토글 방지
      const chId = btn.dataset.chId;
      const qId = btn.dataset.qId;
      await removeWrongQuestion(chId, qId);
    });
  });

  wrap.querySelectorAll('.retry[data-part]').forEach(btn => {
    btn.addEventListener('click', () => {
      const part = PARTS.find(p => p.key === btn.dataset.part);
      const wrongQs = [];
      part.chapters.forEach(ch => {
        const p = progressStore[ch.id] || emptyProgress();
        (p.wrongIds || []).forEach(id => {
          const q = ch.questions.find(qq => qq.id === id);
          if(q) wrongQs.push(q);
        });
      });
      if(!wrongQs.length) return;
      state.origin = 'wrongnote';
      startQuiz(shuffle(wrongQs), part.chapters[0].id, false);
    });
  });
}

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function startQuiz(questions, chapterId, isFullRun){
  state.queue = questions.slice();
  state.idx = 0;
  state.correct = 0;
  state.wrong = [];
  state.currentChapterId = chapterId;
  state.isFullRun = isFullRun;

  const found = findChapter(chapterId);
  if(found){
    document.getElementById('quiz-title').textContent = found.chapter.name;
    document.getElementById('result-chapter-name').textContent = found.chapter.name;
  }

  showScreen('quiz');
  renderQuestion();
}

function renderQuestion(){
  const q = state.queue[state.idx];
  state.answered = false;
  document.getElementById('q-count').textContent = `${state.idx+1} / ${state.queue.length}`;
  document.getElementById('q-source').textContent = q.source || '';
  document.getElementById('q-text').textContent = q.question;
  document.getElementById('qtrack-fill').style.width = `${((state.idx)/state.queue.length)*100}%`;

  const btnO = document.getElementById('btn-o');
  const btnX = document.getElementById('btn-x');
  const btnPass = document.getElementById('btn-pass');
  [btnO, btnX].forEach(b => {
    b.disabled = false;
    b.classList.remove('correct','wrong','reveal');
  });
  btnPass.disabled = false;
  btnPass.classList.remove('wrong');
  btnPass.textContent = 'PASS (모름 · 오답 처리)';

  const fb = document.getElementById('feedback');
  fb.classList.remove('show','correct','wrong');
  fb.textContent = '';
  document.getElementById('next-btn').classList.remove('show');
}

function answer(choice){
  if(state.answered) return;
  state.answered = true;
  const q = state.queue[state.idx];
  const isPass = choice === 'PASS';
  const isCorrect = !isPass && choice === q.answer;

  const btnO = document.getElementById('btn-o');
  const btnX = document.getElementById('btn-x');
  const btnPass = document.getElementById('btn-pass');
  const answerBtn = q.answer === 'O' ? btnO : btnX;

  [btnO, btnX].forEach(b => b.disabled = true);
  btnPass.disabled = true;

  if(isPass){
    btnPass.classList.add('wrong');
    btnPass.textContent = 'PASS';
    answerBtn.classList.add('reveal');
    state.wrong.push(q.id);
  } else if(isCorrect){
    const chosenBtn = choice === 'O' ? btnO : btnX;
    chosenBtn.classList.add('correct');
    state.correct++;
  } else {
    const chosenBtn = choice === 'O' ? btnO : btnX;
    chosenBtn.classList.add('wrong');
    answerBtn.classList.add('reveal');
    state.wrong.push(q.id);
  }

  const fb = document.getElementById('feedback');
  if(isCorrect){
    fb.textContent = '정답입니다!';
    fb.classList.add('show', 'correct');
  } else {
    fb.textContent = `오답입니다. (정답: ${q.answer})`;
    fb.classList.add('show', 'wrong');
  }

  const nextBtn = document.getElementById('next-btn');
  if(state.idx < state.queue.length - 1){
    nextBtn.textContent = '다음 문제';
  } else {
    nextBtn.textContent = '결과 보기';
  }
  nextBtn.classList.add('show');
}

async function finishQuiz(){
  const total = state.queue.length;
  const scoreStr = `${state.correct} / ${total}`;
  const pct = total > 0 ? Math.round((state.correct / total) * 100) : 0;

  document.getElementById('result-score').textContent = scoreStr;
  document.getElementById('result-sub').textContent = `정답률 ${pct}%`;

  // 틀린 횟수 누적 기록 (전체 풀기/오답만 다시 풀기 상관없이 항상 집계)
  const chaptersToSave = new Set();
  state.wrong.forEach(qId => {
    const ch = findChapterOfQuestion(qId);
    if(!ch) return;
    const p = progressStore[ch.id] || emptyProgress();
    p.wrongCounts = p.wrongCounts || {};
    p.wrongCounts[qId] = (p.wrongCounts[qId] || 0) + 1;
    progressStore[ch.id] = p;
    chaptersToSave.add(ch.id);
  });

  if(state.isFullRun && state.currentChapterId){
    const p = progressStore[state.currentChapterId] || emptyProgress();
    p.answeredCount = total;
    p.correctCount = state.correct;
    p.done = true;
    p.wrongIds = state.wrong.slice();
    p.completionCount = (p.completionCount || 0) + 1;
    progressStore[state.currentChapterId] = p;
    chaptersToSave.add(state.currentChapterId);
  }

  for(const chId of chaptersToSave){
    await saveProgress(chId);
  }

  const compEl = document.getElementById('result-complete');
  if(pct === 100){
    compEl.textContent = '🎉 만점입니다! 완벽하게 이해하셨네요.';
  } else if(pct >= 80){
    compEl.textContent = '👍 훌륭합니다! 조금만 더 보완해봐요.';
  } else {
    compEl.textContent = '💪 복습이 필요합니다. 오답노트를 확인해보세요.';
  }

  const retryWrongBtn = document.getElementById('retry-wrong');
  if(state.wrong.length === 0){
    retryWrongBtn.classList.add('hidden');
  } else {
    retryWrongBtn.classList.remove('hidden');
  }

  showScreen('result');
}

/* Event Listeners */
document.getElementById('btn-o').addEventListener('click', () => answer('O'));
document.getElementById('btn-x').addEventListener('click', () => answer('X'));
document.getElementById('btn-pass').addEventListener('click', () => answer('PASS'));

document.getElementById('next-btn').addEventListener('click', () => {
  if(state.idx < state.queue.length - 1){
    state.idx++;
    renderQuestion();
  } else {
    finishQuiz();
  }
});

document.getElementById('open-wrongnote').addEventListener('click', () => {
  renderWrongNoteScreen();
  showScreen('wrongnote');
});

document.getElementById('wrongnote-back').addEventListener('click', () => {
  renderPartBlocks();
  showScreen('home');
});

document.getElementById('quiz-back').addEventListener('click', () => {
  if(state.origin === 'wrongnote'){
    renderWrongNoteScreen();
    showScreen('wrongnote');
  } else {
    renderPartBlocks();
    showScreen('home');
  }
});

document.getElementById('retry-wrong').addEventListener('click', () => {
  const { chapter } = findChapter(state.currentChapterId);
  const wrongQs = state.wrong.map(id => chapter.questions.find(q => q.id === id)).filter(Boolean);
  startQuiz(shuffle(wrongQs), state.currentChapterId, false);
});

document.getElementById('retry-all').addEventListener('click', () => {
  const { chapter } = findChapter(state.currentChapterId);
  startQuiz(shuffle(chapter.questions), state.currentChapterId, true);
});

document.getElementById('go-home').addEventListener('click', () => {
  renderPartBlocks();
  showScreen('home');
});

/* 환경설정 모달 이벤트 */
const settingsModal = document.getElementById('settings-modal');
document.getElementById('open-settings').addEventListener('click', () => {
  settingsModal.classList.remove('hidden');
  updateSyncStatus();
});
document.getElementById('close-settings').addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) settingsModal.classList.add('hidden');
});

// 전체 학습 기록 초기화
document.getElementById('reset-all-progress').addEventListener('click', async () => {
  if (!confirm('모든 챕터의 학습 기록과 오답노트가 삭제됩니다. 정말 초기화하시겠습니까?')) return;
  for (const part of PARTS) {
    for (const ch of part.chapters) {
      progressStore[ch.id] = emptyProgress();
      await saveProgress(ch.id);
    }
  }
  renderPartBlocks();
  settingsModal.classList.add('hidden');
  alert('전체 학습 기록이 초기화되었습니다.');
});

// 오답노트만 초기화
document.getElementById('reset-wrongnote').addEventListener('click', async () => {
  if (!confirm('저장된 오답노트 목록이 삭제됩니다. 계속하시겠습니까?')) return;
  for (const part of PARTS) {
    for (const ch of part.chapters) {
      if (progressStore[ch.id]) {
        progressStore[ch.id].wrongIds = [];
        await saveProgress(ch.id);
      }
    }
  }
  renderPartBlocks();
  settingsModal.classList.add('hidden');
  alert('오답노트 기록이 초기화되었습니다.');
});

document.getElementById('setup-sync').addEventListener('click', setupSync);

window.addEventListener('DOMContentLoaded', async () => {
  initFirebaseIfConfigured();
  await loadAllProgress();
  await syncOnLoad();
  renderPartBlocks();
  updateSyncStatus();
});
