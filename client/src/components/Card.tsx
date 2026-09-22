import { cardImage, cards } from '../lib/cards';

interface CardProps {
  id: number;
  small?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  back?: boolean;
  className?: string;
}

export default function Card({ id, small = false, selected = false, disabled = false, onClick, back = false, className = '' }: CardProps) {
  const card = cards[id];
  const label = back ? '伏せ札' : card ? `${card.month}月・${card.name}` : '花札';
  const classes = ['hana-card', small && 'small', selected && 'selected', back && 'back', disabled && 'disabled', className].filter(Boolean).join(' ');
  const content = <img src={back ? '/cards/back.svg' : cardImage(id)} alt={label} draggable={false} loading="eager" />;

  return onClick ? (
    <button type="button" className={classes} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={selected} data-card-id={id}>
      {content}
    </button>
  ) : (
    <div className={classes} aria-label={label} data-card-id={id}>{content}</div>
  );
}
