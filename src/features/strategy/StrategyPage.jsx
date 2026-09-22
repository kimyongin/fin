import { useEffect, useMemo, useRef, useState } from "react";
import ModalShell from "../../components/ModalShell";
import PrincipleJournal from "./PrincipleJournal";
import { formatKrw, formatPercent } from "../../lib/format";
import {
  archiveOperatingRule,
  createEmptyStrategyState,
  fetchInvestmentPolicy,
  fetchOperatingRules,
  fetchStrategyState,
  saveInvestmentPolicy,
  saveOperatingRule,
  saveStrategy,
} from "./data";

const modes = [
  ["growth", "성장"],
  ["neutral", "중립"],
  ["defensive", "방어"],
];
const modeLabel = Object.fromEntries(modes);
const emptyPrinciples = {
  notes: "",
  max_trade_amount: 1000000,
  monthly_trade_limit: 2000000,
  contribution_repair_months: 3,
  mode_change_max_percentage: 5,
};

function createDraft(strategyState) {
  const strategy = strategyState.strategy;
  const { min_trade_amount: _legacyMinTradeAmount, ...storedPrinciples } =
    strategy?.principles ?? {};
  return {
    name: strategy?.name ?? "나의 전략",
    monthly_contribution: strategy?.monthly_contribution ?? 3000000,
    review_day: strategy?.review_day ?? 1,
    drift_threshold: strategy?.drift_threshold ?? 5,
    mode: strategy?.mode ?? "neutral",
    mode_reason: strategy?.mode_reason ?? "",
    principles: { ...emptyPrinciples, ...storedPrinciples },
    buckets: strategyState.buckets.map((bucket) => ({
      id: bucket.id,
      name: bucket.name,
      tag_ids: bucket.tag_ids.map(String),
      mode_targets: {
        growth: Number(bucket.mode_targets?.growth ?? bucket.target_percentage),
        neutral: Number(
          bucket.mode_targets?.neutral ?? bucket.target_percentage,
        ),
        defensive: Number(
          bucket.mode_targets?.defensive ?? bucket.target_percentage,
        ),
      },
    })),
  };
}

function newBucket() {
  return {
    id: crypto.randomUUID(),
    name: "",
    tag_ids: [],
    mode_targets: { growth: 0, neutral: 0, defensive: 0 },
  };
}
function emptyDraft() {
  return {
    name: "나의 전략",
    monthly_contribution: 3000000,
    review_day: 1,
    drift_threshold: 5,
    mode: "neutral",
    mode_reason: "",
    principles: emptyPrinciples,
    buckets: [newBucket()],
  };
}
function inputClass() {
  return "min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";
}

function BucketEditor({ bucket, onChange, onRemove, selectedTagIds, tags }) {
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_repeat(3,6rem)_auto] lg:items-end">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-[var(--muted-ink)]">
            버킷 이름
          </span>
          <input
            className={inputClass()}
            onChange={(event) =>
              onChange({ ...bucket, name: event.target.value })
            }
            value={bucket.name}
          />
        </label>
        {modes.map(([mode, label]) => (
          <label className="grid gap-1.5" key={mode}>
            <span className="text-xs font-medium text-[var(--muted-ink)]">
              {label} 목표
            </span>
            <input
              className={inputClass()}
              min="0"
              max="100"
              onChange={(event) =>
                onChange({
                  ...bucket,
                  mode_targets: {
                    ...bucket.mode_targets,
                    [mode]: event.target.value,
                  },
                })
              }
              step="0.1"
              type="number"
              value={bucket.mode_targets[mode]}
            />
          </label>
        ))}
        <button
          className="rounded-xl px-3 py-2 text-sm text-[var(--muted-ink)] hover:bg-[var(--surface-3)] hover:text-red-300"
          onClick={onRemove}
          type="button"
        >
          삭제
        </button>
      </div>
      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-[var(--muted-ink)]">
          연결 태그
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {tags.map((tag) => {
            const tagId = String(tag.id);
            const selected = bucket.tag_ids.includes(tagId);
            const unavailable = !selected && selectedTagIds.has(tagId);
            return (
              <label
                className={`inline-flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-sm ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)] text-[var(--muted-ink)]"} ${unavailable ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
                key={tag.id}
              >
                <input
                  checked={selected}
                  disabled={unavailable}
                  onChange={() =>
                    onChange({
                      ...bucket,
                      tag_ids: selected
                        ? bucket.tag_ids.filter((id) => id !== tagId)
                        : [...bucket.tag_ids, tagId],
                    })
                  }
                  type="checkbox"
                />
                {tag.name}
              </label>
            );
          })}
        </div>
      </fieldset>
    </article>
  );
}

function StrategyEditor({
  draft,
  error,
  onCancel,
  onChange,
  onSave,
  saving,
  tags,
}) {
  const totals = Object.fromEntries(
    modes.map(([mode]) => [
      mode,
      draft.buckets.reduce(
        (sum, bucket) => sum + (Number(bucket.mode_targets[mode]) || 0),
        0,
      ),
    ]),
  );
  const canSave =
    draft.name.trim() &&
    draft.buckets.length > 0 &&
    modes.every(([mode]) => Math.abs(totals[mode] - 100) < 0.01) &&
    !saving;
  return (
    <section className="grid gap-5">
      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">전략 편집</h2>
            <p className="mt-1 text-sm text-[var(--muted-ink)]">
              장기 버킷과 모드별 목표 비중을 정합니다.
            </p>
          </div>
          <button
            className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
            onClick={onCancel}
            type="button"
          >
            취소
          </button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-xs text-[var(--muted-ink)]">전략 이름</span>
            <input
              className={inputClass()}
              onChange={(event) =>
                onChange({ ...draft, name: event.target.value })
              }
              value={draft.name}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs text-[var(--muted-ink)]">월 적립금</span>
            <input
              className={inputClass()}
              min="0"
              onChange={(event) =>
                onChange({ ...draft, monthly_contribution: event.target.value })
              }
              type="number"
              value={draft.monthly_contribution}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs text-[var(--muted-ink)]">매월 점검일</span>
            <input
              className={inputClass()}
              min="1"
              max="28"
              onChange={(event) =>
                onChange({ ...draft, review_day: event.target.value })
              }
              type="number"
              value={draft.review_day}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs text-[var(--muted-ink)]">
              허용 이탈 폭 (%p)
            </span>
            <input
              className={inputClass()}
              min="0.1"
              max="100"
              onChange={(event) =>
                onChange({ ...draft, drift_threshold: event.target.value })
              }
              step="0.1"
              type="number"
              value={draft.drift_threshold}
            />
          </label>
        </div>
      </article>
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">모드 프리셋</h2>
            <p className="mt-1 text-sm text-[var(--muted-ink)]">
              {modes
                .map(
                  ([mode, label]) => `${label} ${formatPercent(totals[mode])}%`,
                )
                .join(" · ")}
            </p>
          </div>
          <button
            className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
            onClick={() =>
              onChange({ ...draft, buckets: [...draft.buckets, newBucket()] })
            }
            type="button"
          >
            버킷 추가
          </button>
        </div>
        {draft.buckets.map((bucket, index) => (
          <BucketEditor
            bucket={bucket}
            key={bucket.id ?? index}
            onChange={(next) =>
              onChange({
                ...draft,
                buckets: draft.buckets.map((item, itemIndex) =>
                  itemIndex === index ? next : item,
                ),
              })
            }
            onRemove={() =>
              onChange({
                ...draft,
                buckets: draft.buckets.filter(
                  (_, itemIndex) => itemIndex !== index,
                ),
              })
            }
            selectedTagIds={
              new Set(
                draft.buckets
                  .filter((_, itemIndex) => itemIndex !== index)
                  .flatMap((item) => item.tag_ids),
              )
            }
            tags={tags}
          />
        ))}
      </section>
      {error && (
        <p className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!canSave}
          onClick={onSave}
          type="button"
        >
          {saving ? "저장 중" : "전략 저장"}
        </button>
      </div>
    </section>
  );
}

function ModeModal({ draft, onClose, onSave, saving }) {
  const [next, setNext] = useState({
    mode: draft.mode,
    mode_reason: draft.mode_reason,
  });
  return (
    <ModalShell onClose={onClose} title="운용 모드 변경">
      <div className="grid gap-4">
        <label className="grid gap-1.5">
          <span className="text-xs text-[var(--muted-ink)]">모드</span>
          <select
            className={inputClass()}
            onChange={(event) => setNext({ ...next, mode: event.target.value })}
            value={next.mode}
          >
            {modes.map(([mode, label]) => (
              <option key={mode} value={mode}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs text-[var(--muted-ink)]">변경 사유</span>
          <textarea
            className={`${inputClass()} min-h-28 resize-y`}
            onChange={(event) =>
              setNext({ ...next, mode_reason: event.target.value })
            }
            placeholder="뉴스 기록이나 시장 판단을 간단히 남기세요."
            value={next.mode_reason}
          />
        </label>
        <p className="text-sm leading-6 text-[var(--muted-ink)]">
          모드는 목표 비중 프리셋만 바꿉니다. 실제 매매는 원칙과 본인의 최종
          판단에 따라 직접 결정합니다.
        </p>
        <div className="flex justify-end gap-2">
          <button
            className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm"
            onClick={onClose}
            type="button"
          >
            취소
          </button>
          <button
            className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            disabled={saving}
            onClick={() => onSave(next)}
            type="button"
          >
            {saving ? "저장 중" : "모드 적용"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function PrinciplesModal({ draft, onClose, onSave, saving }) {
  const [principles, setPrinciples] = useState(draft.principles);
  const field = (key, label, suffix = "원") => (
    <label className="grid gap-1.5">
      <span className="text-xs text-[var(--muted-ink)]">{label}</span>
      <div className="flex items-center gap-2">
        <input
          className={inputClass()}
          min="0"
          onChange={(event) =>
            setPrinciples({ ...principles, [key]: event.target.value })
          }
          type="number"
          value={principles[key]}
        />
        <span className="text-xs text-[var(--muted-ink)]">{suffix}</span>
      </div>
    </label>
  );
  return (
    <ModalShell onClose={onClose} title="배분 계산 한도 편집">
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {field("max_trade_amount", "단일 거래 최대금액")}
          {field("monthly_trade_limit", "월간 누적 거래 한도")}
          {field("contribution_repair_months", "적립금 우선 보정 기간", "개월")}
          {field(
            "mode_change_max_percentage",
            "모드 변경 1회 최대 조정폭",
            "%p",
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm"
            onClick={onClose}
            type="button"
          >
            취소
          </button>
          <button
            className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            disabled={saving}
            onClick={() => {
              const { min_trade_amount: _legacy, ...nextPrinciples } =
                principles;
              onSave({
                ...nextPrinciples,
                max_trade_amount: Number(principles.max_trade_amount) || 0,
                monthly_trade_limit:
                  Number(principles.monthly_trade_limit) || 0,
                contribution_repair_months:
                  Number(principles.contribution_repair_months) || 0,
                mode_change_max_percentage:
                  Number(principles.mode_change_max_percentage) || 0,
              });
            }}
            type="button"
          >
            {saving ? "저장 중" : "원칙 저장"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function policyDraft(profile) {
  return {
    raw_text: profile?.raw_text ?? "",
    goal_text: profile?.goal_text ?? "",
    horizon_text: profile?.horizon_text ?? "",
    liquidity_need_text: profile?.liquidity_need_text ?? "",
    risk_tolerance_text: profile?.risk_tolerance_text ?? "",
    trading_preference_text: profile?.trading_preference_text ?? "",
    preferences: (profile?.restrictions ?? [])
      .filter((item) => item.kind === "preference")
      .map((item) => item.text)
      .join("\n"),
    prohibitions: (profile?.restrictions ?? [])
      .filter((item) => item.kind === "prohibition")
      .map((item) => item.text)
      .join("\n"),
    change_reason: "",
  };
}

function policyLines(value, kind) {
  return value
    .split("\n")
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ kind, text }));
}

function InvestmentPolicyModal({ onClose, onSave, profile, saving }) {
  const [draft, setDraft] = useState(() => policyDraft(profile));
  const textField = (key, label, placeholder) => (
    <label className="grid gap-1.5">
      <span className="text-xs text-[var(--muted-ink)]">{label}</span>
      <textarea
        className={`${inputClass()} min-h-20 resize-y`}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
        placeholder={placeholder}
        value={draft[key]}
      />
    </label>
  );
  return (
    <ModalShell onClose={onClose} title="나의 투자 기준 편집">
      <div className="grid gap-4">
        <p className="text-sm leading-6 text-[var(--muted-ink)]">
          모르는 항목은 비워두세요. 운용 모드나 현재 보유 종목으로 성향을 자동
          추정하지 않습니다.
        </p>
        {textField(
          "raw_text",
          "한 줄로 적는 기본 원칙",
          "예: 장기 투자하고 자주 매매하지 않는다.",
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {textField(
            "goal_text",
            "투자 목적",
            "예: 은퇴 자산을 장기적으로 늘린다.",
          )}
          {textField("horizon_text", "투자 기간", "예: 10년 이상")}
          {textField(
            "liquidity_need_text",
            "자금 필요와 유동성",
            "예: 3년 안에 쓸 가능성이 있는 돈은 투자하지 않는다.",
          )}
          {textField(
            "risk_tolerance_text",
            "변동성·손실에 대한 기준",
            "숫자 손절선이 아니라 감수 가능한 상황을 적습니다.",
          )}
          {textField(
            "trading_preference_text",
            "매매 선호",
            "예: 잦은 매매보다 적립식 매수를 선호한다.",
          )}
          {textField(
            "preferences",
            "선호 조건 · 한 줄에 하나",
            "예: 저비용 인덱스 상품을 우선 검토한다.",
          )}
          {textField(
            "prohibitions",
            "하지 않을 것 · 한 줄에 하나",
            "예: 레버리지 상품은 매수하지 않는다.",
          )}
        </div>
        <label className="grid gap-1.5">
          <span className="text-xs text-[var(--muted-ink)]">변경 이유</span>
          <input
            className={inputClass()}
            onChange={(event) =>
              setDraft({ ...draft, change_reason: event.target.value })
            }
            placeholder="왜 이 기준을 저장하거나 바꾸는지 짧게 적어주세요."
            value={draft.change_reason}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm"
            onClick={onClose}
            type="button"
          >
            취소
          </button>
          <button
            className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={saving || !draft.change_reason.trim()}
            onClick={() =>
              onSave({
                changeReason: draft.change_reason.trim(),
                patch: {
                  raw_text: draft.raw_text.trim() || null,
                  goal_text: draft.goal_text.trim() || null,
                  horizon_text: draft.horizon_text.trim() || null,
                  liquidity_need_text: draft.liquidity_need_text.trim() || null,
                  risk_tolerance_text: draft.risk_tolerance_text.trim() || null,
                  trading_preference_text:
                    draft.trading_preference_text.trim() || null,
                  restrictions: [
                    ...policyLines(draft.preferences, "preference"),
                    ...policyLines(draft.prohibitions, "prohibition"),
                  ],
                },
              })
            }
            type="button"
          >
            {saving ? "저장 중" : "기준 저장"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function InvestmentPolicyCard({ onEdit, profile }) {
  const rows = [
    ["투자 목적", profile?.goal_text],
    ["투자 기간", profile?.horizon_text],
    ["자금 필요", profile?.liquidity_need_text],
    ["위험 기준", profile?.risk_tolerance_text],
    ["매매 선호", profile?.trading_preference_text],
  ].filter(([, value]) => value);
  return (
    <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">나의 투자 기준</h2>
          <p className="mt-1 text-sm text-[var(--muted-ink)]">
            ChatGPT의 제안을 해석하는 개인 기준이며 기본적으로 나만 볼 수
            있습니다.
          </p>
        </div>
        <button
          className="shrink-0 rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
          onClick={onEdit}
          type="button"
        >
          {profile ? "기준 편집" : "기준 추가"}
        </button>
      </div>
      {!profile ? (
        <p className="mt-4 text-sm text-[var(--muted-ink)]">
          아직 저장된 개인 기준이 없습니다. 비워둔 항목은 추정하지 않습니다.
        </p>
      ) : (
        <div className="mt-4 grid gap-4">
          {profile.raw_text && (
            <p className="rounded-2xl bg-[var(--surface-2)] p-4 text-sm leading-6">
              {profile.raw_text}
            </p>
          )}
          {rows.length > 0 && (
            <dl className="grid gap-3 sm:grid-cols-2">
              {rows.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-[var(--muted-ink)]">{label}</dt>
                  <dd className="mt-1 text-sm leading-6">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {profile.restrictions?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {profile.restrictions.map((item, index) => (
                <span
                  className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs"
                  key={`${item.kind}-${index}`}
                >
                  {item.kind === "prohibition" ? "금지" : "선호"} · {item.text}
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-[var(--muted-ink)]">
            기준 버전 {profile.version}
          </p>
        </div>
      )}
    </article>
  );
}

function OperatingRuleModal({ onClose, onSave, rule, saving }) {
  const [draft, setDraft] = useState(() => ({
    title: rule?.title ?? "",
    applicability: rule?.applicability ?? "",
    body: rule?.body ?? "",
    changeReason: "",
  }));
  const field = (key, label, placeholder, rows = 3) => (
    <label className="grid gap-1.5">
      <span className="text-xs text-[var(--muted-ink)]">{label}</span>
      <textarea
        className={`${inputClass()} resize-y`}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
        placeholder={placeholder}
        rows={rows}
        value={draft[key]}
      />
    </label>
  );
  const valid = draft.title.trim() && draft.applicability.trim() && draft.body.trim() && draft.changeReason.trim();
  return (
    <ModalShell onClose={onClose} title={rule ? "데이터 관리 규칙 편집" : "데이터 관리 규칙 추가"}>
      <div className="grid gap-4">
        <p className="text-sm leading-6 text-[var(--muted-ink)]">
          현재는 잔고 대조에 적용됩니다. 적용 조건과 처리 방법을 나눠 적으면 ChatGPT가 실제 파일과 대조할 수 있습니다.
        </p>
        <label className="grid gap-1.5">
          <span className="text-xs text-[var(--muted-ink)]">규칙 이름</span>
          <input className={inputClass()} onChange={(event) => setDraft({ ...draft, title: event.target.value })} value={draft.title} />
        </label>
        {field("applicability", "언제 적용하나요?", "예: 미래에셋 HTS에서 내려받은 국내주식 잔고 XLS", 2)}
        {field("body", "어떻게 해석하나요?", "예: 평균가가 없으면 매입금액을 수량으로 나누되, 수량이 0이면 계산하지 않는다.", 5)}
        <label className="grid gap-1.5">
          <span className="text-xs text-[var(--muted-ink)]">변경 이유</span>
          <input className={inputClass()} onChange={(event) => setDraft({ ...draft, changeReason: event.target.value })} value={draft.changeReason} />
        </label>
        <div className="flex justify-end gap-2">
          <button className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm" onClick={onClose} type="button">취소</button>
          <button
            className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!valid || saving}
            onClick={() => onSave(draft)}
            type="button"
          >
            {saving ? "저장 중" : "규칙 저장"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function OperatingRulesCard({ onAdd, onArchive, onEdit, rules }) {
  return (
    <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">데이터 관리 규칙</h2>
          <p className="mt-1 text-sm text-[var(--muted-ink)]">파일과 앱 데이터를 대조할 때 반복해서 사용할 해석 기준입니다.</p>
        </div>
        <button className="shrink-0 rounded-xl border border-[var(--line)] px-3 py-2 text-sm" onClick={onAdd} type="button">규칙 추가</button>
      </div>
      {rules.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted-ink)]">저장된 규칙이 없습니다. 규칙이 없어도 잔고 대조는 사용할 수 있습니다.</p>
      ) : (
        <div className="mt-4 grid gap-3">
          {rules.map((rule) => (
            <section className="rounded-2xl bg-[var(--surface-2)] p-4" key={rule.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{rule.title}</h3>
                  <p className="mt-1 text-xs text-[var(--muted-ink)]">적용 조건 · {rule.applicability}</p>
                </div>
                <span className="text-xs text-[var(--muted-ink)]">v{rule.version}</span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{rule.body}</p>
              <div className="mt-3 flex gap-2">
                <button className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs" onClick={() => onEdit(rule)} type="button">편집</button>
                <button className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted-ink)] hover:text-red-300" onClick={() => onArchive(rule)} type="button">보관</button>
              </div>
            </section>
          ))}
        </div>
      )}
    </article>
  );
}

function StrategyDashboard({
  canEdit,
  onEdit,
  onEditMode,
  onEditPrinciples,
  strategyState,
  tagCards,
  totalValue,
  valuationQuality,
  showCalculations = true,
}) {
  const { strategy, buckets } = strategyState;
  const principles = { ...emptyPrinciples, ...(strategy.principles ?? {}) };
  const mode = strategy.mode ?? "neutral";
  const calculationAvailable = valuationQuality?.isComplete !== false;
  const values = useMemo(
    () => new Map(tagCards.map((tag) => [String(tag.id), tag.value])),
    [tagCards],
  );
  const rows = useMemo(
    () =>
      buckets.map((bucket) => {
        const value = bucket.tag_ids.reduce(
          (sum, id) => sum + (values.get(String(id)) ?? 0),
          0,
        );
        const targetPercentage = Number(
          bucket.mode_targets?.[mode] ?? bucket.target_percentage,
        );
        const currentPercentage =
          calculationAvailable && totalValue > 0
            ? (value / totalValue) * 100
            : null;
        return {
          ...bucket,
          value,
          targetPercentage,
          currentPercentage,
          differencePercentage:
            currentPercentage == null
              ? null
              : targetPercentage - currentPercentage,
          differenceValue:
            currentPercentage == null
              ? null
              : (totalValue * targetPercentage) / 100 - value,
        };
      }),
    [buckets, calculationAvailable, mode, totalValue, values],
  );
  const contribution = Number(strategy.monthly_contribution) || 0;
  const threshold = Number(strategy.drift_threshold);
  const deficits = rows.filter((row) => row.differenceValue > 0);
  const totalDeficit = deficits.reduce(
    (sum, row) => sum + row.differenceValue,
    0,
  );
  const rebalance = rows.filter(
    (row) => Math.abs(row.differencePercentage) >= threshold,
  );
  const tradeCap = Math.min(
    Number(principles.max_trade_amount) || Infinity,
    Number(principles.monthly_trade_limit) || Infinity,
  );
  const repairMonths = Math.max(
    1,
    Number(principles.contribution_repair_months) || 1,
  );
  return (
    <section className="grid gap-5">
      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{strategy.name}</h2>
              <span className="rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold">
                운용 모드 · {modeLabel[mode]}
              </span>
            </div>
            <p className="mt-2 text-sm text-[var(--muted-ink)]">
              매월 {strategy.review_day}일 점검 · 허용 이탈 폭 ±
              {formatPercent(threshold)}p · 월 적립금 {formatKrw(contribution)}
            </p>
            {strategy.mode_reason && (
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted-ink)]">
                <span className="font-semibold text-[var(--ink)]">
                  모드 사유:
                </span>{" "}
                {strategy.mode_reason}
              </p>
            )}
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <button
                className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                onClick={onEditMode}
                type="button"
              >
                모드 변경
              </button>
              <button
                className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                onClick={onEdit}
                type="button"
              >
                전략 편집
              </button>
            </div>
          )}
        </div>
      </article>
      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">배분 계산 한도</h2>
            <p className="mt-1 text-sm text-[var(--muted-ink)]">
              모드는 목표를 정하고, 원칙은 조정 범위와 실행 조건을 제한합니다.
            </p>
          </div>
          {canEdit && (
            <button
              className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
              onClick={onEditPrinciples}
              type="button"
            >
              한도 편집
            </button>
          )}
        </div>
        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <p>
            단일 거래 한도{" "}
            <strong>{formatKrw(Number(principles.max_trade_amount))}</strong>
          </p>
          <p>
            월간 거래 한도{" "}
            <strong>{formatKrw(Number(principles.monthly_trade_limit))}</strong>
          </p>
          <p>
            적립금 우선 보정{" "}
            <strong>{principles.contribution_repair_months}개월</strong>
          </p>
          <p>
            모드 변경 조정폭{" "}
            <strong>
              최대{" "}
              {formatPercent(Number(principles.mode_change_max_percentage))}p
            </strong>
          </p>
        </div>
      </article>
      {showCalculations && (!calculationAvailable ? (
        <article className="rounded-[28px] border border-amber-400/40 bg-amber-500/10 p-5 text-amber-100">
          <h2 className="text-lg font-semibold">비중 계산을 잠시 멈췄습니다.</h2>
          <p className="mt-2 text-sm leading-6">
            평가할 수 없는 보유 항목이 {valuationQuality.unknownPositionCount}개 있어
            목표 비중·적립금 배분·리밸런싱 금액을 계산하지 않습니다. 자산 화면에서
            누락된 시세나 환율을 확인해 주세요.
          </p>
        </article>
      ) : (
        <>
      <article className="overflow-hidden rounded-[28px] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-soft)]">
        <div className="border-b border-[var(--line)] px-5 py-4">
          <h2 className="text-lg font-semibold">
            {modeLabel[mode]} 모드 목표 대비 현재 비중
          </h2>
        </div>
        <div className="divide-y divide-[var(--line)] px-5">
          {rows.map((row) => (
            <div
              className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-3 py-3 text-sm"
              key={row.id}
            >
              <span className="truncate font-semibold">{row.name}</span>
              <span className="text-right text-[var(--muted-ink)]">
                {formatPercent(row.targetPercentage)}
              </span>
              <span className="text-right">
                {formatPercent(row.currentPercentage)}
              </span>
              <span className="col-span-3 text-xs text-[var(--muted-ink)]">
                {formatKrw(row.value)} ·{" "}
                {row.differencePercentage > 0
                  ? "목표 대비 부족"
                  : row.differencePercentage < 0
                    ? "목표 대비 초과"
                    : "목표 일치"}{" "}
                {formatPercent(Math.abs(row.differencePercentage))}p
              </span>
            </div>
          ))}
        </div>
      </article>
      <div className="grid gap-5 lg:grid-cols-2">
        <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
          <h2 className="text-lg font-semibold">이번 달 적립금 배분</h2>
          <p className="mt-1 text-sm text-[var(--muted-ink)]">
            {modeLabel[mode]} 모드에서 부족한 버킷을 적립금으로 먼저 보정합니다.
          </p>
          <div className="mt-4 grid gap-3">
            {deficits.length === 0 ? (
              <p className="text-sm text-[var(--muted-ink)]">
                부족한 버킷이 없습니다.
              </p>
            ) : (
              deficits.map((row) => {
                const amount =
                  (contribution * row.differenceValue) / totalDeficit;
                return (
                  <div
                    className="border-t border-[var(--line)] pt-3"
                    key={row.id}
                  >
                    <div className="flex justify-between gap-3 text-sm">
                      <strong>{row.name}</strong>
                      <strong>{formatKrw(amount)}</strong>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted-ink)]">
                      근거: {modeLabel[mode]} 목표 대비{" "}
                      {formatPercent(row.differencePercentage)}p 부족 · 적립금
                      우선 보정
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </article>
        <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
          <h2 className="text-lg font-semibold">리밸런싱 제안</h2>
          <p className="mt-1 text-sm text-[var(--muted-ink)]">
            허용 이탈 폭을 넘은 항목만 검토합니다. 실제 매매는 직접 결정하세요.
          </p>
          <div className="mt-4 grid gap-3">
            {rebalance.length === 0 ? (
              <p className="text-sm text-[var(--muted-ink)]">
                모든 버킷이 허용 이탈 폭 안에 있습니다.
              </p>
            ) : (
              rebalance.map((row) => {
                const repairable =
                  row.differenceValue > 0 &&
                  contribution *
                    repairMonths *
                    (totalDeficit ? row.differenceValue / totalDeficit : 0) >=
                    row.differenceValue;
                const action = repairable
                  ? "적립금으로 우선 보정"
                  : row.differenceValue > 0
                    ? "매수 검토"
                    : "매도 검토";
                const amount = Math.min(
                  Math.abs(row.differenceValue),
                  tradeCap,
                );
                return (
                  <div
                    className="border-t border-[var(--line)] pt-3"
                    key={row.id}
                  >
                    <div className="flex justify-between gap-3 text-sm">
                      <strong>
                        {row.name} · {action}
                      </strong>
                      {!repairable && <strong>최대 {formatKrw(amount)}</strong>}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted-ink)]">
                      근거: 목표 대비{" "}
                      {formatPercent(Math.abs(row.differencePercentage))}p 이탈
                      · 허용 폭 {formatPercent(threshold)}p ·{" "}
                      {repairable
                        ? `${repairMonths}개월 적립금 보정 가능`
                        : `거래 한도 ${formatKrw(tradeCap)} 적용`}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </article>
      </div>
        </>
      ))}
    </section>
  );
}

export default function StrategyPage({
  canEdit,
  ownerUserId = null,
  supabase,
  tagCards,
  tags,
  totalValue,
  valuationQuality,
  section = "all",
  onBack,
}) {
  const [strategyState, setStrategyState] = useState(
    createEmptyStrategyState(),
  );
  const [policy, setPolicy] = useState(null);
  const [operatingRules, setOperatingRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [editingMode, setEditingMode] = useState(false);
  const [editingPrinciples, setEditingPrinciples] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState(false);
  const [editingRule, setEditingRule] = useState(undefined);
  const [draft, setDraft] = useState(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const policySaveAttempt = useRef(null);
  const ruleSaveAttempt = useRef(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetchStrategyState(supabase, ownerUserId),
      canEdit ? fetchInvestmentPolicy(supabase) : Promise.resolve(null),
      canEdit ? fetchOperatingRules(supabase, "reconciliation") : Promise.resolve([]),
    ])
      .then(([next, nextPolicy, nextRules]) => {
        if (!active) return;
        setStrategyState(next);
        setPolicy(nextPolicy);
        setOperatingRules(nextRules);
        setDraft(next.strategy ? createDraft(next) : emptyDraft());
        setEditing(false);
      })
      .catch(
        (nextError) =>
          active &&
          setError(nextError.message ?? "원칙을 불러오지 못했습니다."),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [canEdit, ownerUserId, supabase]);
  async function persist(nextDraft, afterSave) {
    setSaving(true);
    setError("");
    try {
      const next = await saveStrategy(supabase, nextDraft);
      setStrategyState(next);
      setDraft(createDraft(next));
      afterSave?.();
    } catch (nextError) {
      setError(nextError.message ?? "전략을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }
  async function persistPolicy({ patch, changeReason }) {
    setSavingPolicy(true);
    setError("");
    const expectedVersion = policy?.version ?? null;
    const signature = JSON.stringify({ expectedVersion, patch, changeReason });
    if (policySaveAttempt.current?.signature !== signature)
      policySaveAttempt.current = { signature, key: crypto.randomUUID() };
    try {
      const nextPolicy = await saveInvestmentPolicy(supabase, {
        expectedVersion,
        idempotencyKey: policySaveAttempt.current.key,
        patch,
        changeReason,
      });
      policySaveAttempt.current = null;
      setPolicy(nextPolicy);
      setEditingPolicy(false);
    } catch (nextError) {
      setError(nextError.message ?? "투자 기준을 저장하지 못했습니다.");
    } finally {
      setSavingPolicy(false);
    }
  }
  async function persistRule(ruleDraft) {
    setSavingRule(true);
    setError("");
    const signature = JSON.stringify({ id: editingRule?.id ?? null, version: editingRule?.version ?? null, ...ruleDraft });
    if (ruleSaveAttempt.current?.signature !== signature) ruleSaveAttempt.current = { signature, key: crypto.randomUUID() };
    try {
      const nextRule = await saveOperatingRule(supabase, {
        id: editingRule?.id ?? null,
        expectedVersion: editingRule?.version ?? null,
        idempotencyKey: ruleSaveAttempt.current.key,
        title: ruleDraft.title,
        workflowKey: "reconciliation",
        applicability: ruleDraft.applicability,
        body: ruleDraft.body,
        changeReason: ruleDraft.changeReason,
      });
      setOperatingRules((current) => [nextRule, ...current.filter((item) => item.id !== nextRule.id)]);
      ruleSaveAttempt.current = null;
      setEditingRule(undefined);
    } catch (nextError) {
      setError(nextError.message ?? "데이터 관리 규칙을 저장하지 못했습니다.");
    } finally {
      setSavingRule(false);
    }
  }
  async function archiveRule(rule) {
    if (!window.confirm(`“${rule.title}” 규칙을 보관할까요?`)) return;
    setError("");
    try {
      await archiveOperatingRule(supabase, {
        id: rule.id, expectedVersion: rule.version, idempotencyKey: crypto.randomUUID(), reason: "앱에서 규칙을 보관했습니다.",
      });
      setOperatingRules((current) => current.filter((item) => item.id !== rule.id));
    } catch (nextError) {
      setError(nextError.message ?? "데이터 관리 규칙을 보관하지 못했습니다.");
    }
  }
  if (loading)
    return (
      <p className="mt-8 text-sm text-[var(--muted-ink)]">
        원칙을 불러오는 중입니다.
      </p>
    );
  if (!strategyState.strategy && !canEdit)
    return (
      <p className="mt-8 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 text-sm text-[var(--muted-ink)]">
        공유된 전략이 아직 없습니다.
      </p>
    );
  if (editing)
    return (
      <div className="mt-8">
        <StrategyEditor
          draft={draft}
          error={error}
          onCancel={() => {
            setDraft(
              strategyState.strategy
                ? createDraft(strategyState)
                : emptyDraft(),
            );
            setEditing(false);
            setError("");
          }}
          onChange={setDraft}
          onSave={() => persist(draft, () => setEditing(false))}
          saving={saving}
          tags={tags}
        />
      </div>
    );
  return (
    <div className="grid gap-5">
      {onBack && (
        <button
          className="min-h-11 w-fit rounded-xl border border-[var(--line)] px-4 text-sm font-semibold"
          onClick={onBack}
          type="button"
        >
          자산으로 돌아가기
        </button>
      )}
      {canEdit && section !== "allocation" && (
        <PrincipleJournal supabase={supabase} />
      )}
      {error && (
        <p className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </p>
      )}
      {strategyState.strategy ? (
        <StrategyDashboard
          canEdit={canEdit}
          onEdit={() => {
            setDraft(createDraft(strategyState));
            setEditing(true);
          }}
          onEditMode={() => setEditingMode(true)}
          onEditPrinciples={() => setEditingPrinciples(true)}
          strategyState={strategyState}
          tagCards={tagCards}
          totalValue={totalValue}
          valuationQuality={valuationQuality}
          showCalculations={section !== "principles"}
        />
      ) : (
        <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
          <h2 className="text-lg font-semibold">아직 운용 전략이 없습니다.</h2>
          <p className="mt-2 text-sm text-[var(--muted-ink)]">
            개인 기준과 별도로 목표 비중·적립금·운용 모드를 설정할 수 있습니다.
          </p>
          <button
            className="mt-4 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white"
            onClick={() => setEditing(true)}
            type="button"
          >
            전략 만들기
          </button>
        </article>
      )}
      {editingMode && (
        <ModeModal
          draft={draft}
          onClose={() => setEditingMode(false)}
          onSave={(next) =>
            persist({ ...draft, ...next }, () => setEditingMode(false))
          }
          saving={saving}
        />
      )}
      {editingPrinciples && (
        <PrinciplesModal
          draft={draft}
          onClose={() => setEditingPrinciples(false)}
          onSave={(principles) =>
            persist({ ...draft, principles }, () => setEditingPrinciples(false))
          }
          saving={saving}
        />
      )}
      {editingPolicy && (
        <InvestmentPolicyModal
          onClose={() => setEditingPolicy(false)}
          onSave={persistPolicy}
          profile={policy}
          saving={savingPolicy}
        />
      )}
      {editingRule !== undefined && (
        <OperatingRuleModal
          onClose={() => setEditingRule(undefined)}
          onSave={persistRule}
          rule={editingRule}
          saving={savingRule}
        />
      )}
    </div>
  );
}
