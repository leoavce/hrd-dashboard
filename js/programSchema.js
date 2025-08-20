// js/programSchema.js
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/** 기본 스키마: 두 컷의 하위 요소들 */
export const DEFAULT_SCHEMA = {
  sections: {
    widgets: ['summary','budget','outcome','design'],     // 위젯 4카드
    items:   ['content','budget','outcome','design']      // 항목별 4블록
  }
};

/** 스키마 로드 (없으면 기본값 저장 후 반환) */
export async function getProgramSchema(db, programId){
  const ref = doc(db,'programs',programId,'meta','schema');
  const snap = await getDoc(ref);
  if (!snap.exists()){
    await setDoc(ref, { sections: DEFAULT_SCHEMA.sections, updatedAt: Date.now() }, { merge:true });
    return DEFAULT_SCHEMA;
  }
  const data = snap.data();
  // 방어: 누락 키 보정
  const widgets = Array.isArray(data.sections?.widgets) ? data.sections.widgets : DEFAULT_SCHEMA.sections.widgets;
  const items   = Array.isArray(data.sections?.items)   ? data.sections.items   : DEFAULT_SCHEMA.sections.items;
  return { sections: { widgets, items } };
}
