/**
 * 카드 효과 텍스트를 렌더한다.
 *
 * 【공격후】, 【대응】, 【필중】 같은 대괄호 키워드를 강조 표시한다.
 * 텍스트는 데이터에서 그대로 읽으므로, 문구를 고치면 카드에 바로 반영된다.
 */
export function CardText({ text }: { text: string }) {
  const parts = text.split(/(【[^】]+】)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("【") ? (
          <span key={i} className="kw">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
