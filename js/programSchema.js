// js/programSchema.js
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * 섹션 정의(표준 아이디와 제목)
 * - 'single:*' 는 단일(연도와 무관한) 항목 섹션
 * - 'yearly' 는 연도별 상세 섹션
 */
export const SECTION_DEFS = {
  "widget":         { id: "widget",         title: "위젯(종합)" },
  "single:budget":  { id: "single:budget",  title: "예산" },
  "single:design":  { id: "single:design",  title: "디자인" },
  "single:outcome": { id: "single:outcome", title: "교육 성과" },
  "single:content": { id: "single:content", title: "교육 내용" },
  "yearly":         { id: "yearly",         title: "연도별 상세" }
};

/** 기본 스키마(초기값) */
export const DEFAULT_SCHEMA = {
  sections: ["widget", "single:budget", "single:design", "single:outcome", "single:content", "yearly"]
};

/** 유효한 섹션만 필터링하여 정제 */
function normalizeSchema(raw) {
  if (!raw || !Array.isArray(raw.sections)) return { ...DEFAULT_SCHEMA };
  const valid = raw.sections.filter(id => SECTION_DEFS[id]);
  return { sections: valid.length ? valid : [ ...DEFAULT_SCHEMA.sections ] };
}

/** 프로그램별 스키마 로드 */
export async function getProgramSchema(db, programId) {
  try {
    const snap = await getDoc(doc(db, "programs", programId, "meta", "schema"));
    if (!snap.exists()) return { ...DEFAULT_SCHEMA };
    return normalizeSchema(snap.data());
  } catch {
    return { ...DEFAULT_SCHEMA };
  }
}

/**
 * 프로그램별 스키마 저장
 * @param {Array<string>} sections - 섹션 id 배열 (SECTION_DEFS 키 사용)
 */
export async function setProgramSchema(db, programId, sections) {
  const normalized = normalizeSchema({ sections });
  await setDoc(
    doc(db, "programs", programId, "meta", "schema"),
    { sections: normalized.sections, updatedAt: Date.now() },
    { merge: true }
  );
  return normalized;
}
