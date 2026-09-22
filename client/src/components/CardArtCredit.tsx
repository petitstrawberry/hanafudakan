/** Visible attribution for the self-hosted, CC BY-SA licensed card faces. */
export default function CardArtCredit({ className = '' }: { className?: string }) {
  return (
    <p className={['card-art-credit', className].filter(Boolean).join(' ')}>
      絵札：<a href="https://www.junior.cards/about/" target="_blank" rel="noreferrer">Louie Mantia</a>
      {' · '}色彩：<a href="https://github.com/dotty-dev/Hanafuda-Louie-Recolor/tree/a4ac60e4bd60f95ab8c4e5176b50bfd2e3772992" target="_blank" rel="noreferrer">dotty-dev</a>
      {' · '}<a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>
      {' · '}<a href="/cards/ATTRIBUTION.md" target="_blank" rel="noreferrer">出典・ライセンス</a>
    </p>
  );
}
