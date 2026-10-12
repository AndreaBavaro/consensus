import React from 'react';
import styles from './SourceCard.module.css';
import type { CSSVars } from '../../../../types';
import SourceIcon, { sourceLabel } from '../../../common/SourceIcon';

const MAX_TITLE_LENGTH = 80;

const truncateText = (text = '') => {
  const clean = text.replace(/\s*:\s*r\/\w+\s*-\s*Reddit$/i, '');
  return clean.length > MAX_TITLE_LENGTH ? `${clean.slice(0, MAX_TITLE_LENGTH).trimEnd()}...` : clean;
};

interface SourceCardProps {
  title?: string;
  link?: string;
  subreddit?: string | null;
  position: 'left' | 'right';
  style: CSSVars;
  isLoading?: boolean;
}

const SourceCard = ({ title, link, subreddit, position, style, isLoading = false }: SourceCardProps) => {
  if (isLoading) {
    return (
      <div className={`${styles.card} ${styles[position]}`} style={style}>
        {position === 'right' && style['--index'] === 3 ? (
          <div className={styles.skeletonShowMore} />
        ) : (
          <>
            <div className={styles.skeletonTitle} />
            <div className={styles.footer}>
              <div className={styles.skeletonSubreddit} />
            </div>
          </>
        )}
      </div>
    );
  }

  const handleClick = () => {
    window.open(link, "_blank");
  };

  return (
    <div className={`${styles.card} ${styles[position]} ${styles.fadeIn}`} onClick={handleClick} style={style}>
      <p className={styles.title}>
        {truncateText(title)}
      </p>
      <div className={styles.footer}>
        <SourceIcon source={subreddit} className={styles.redditIcon} />
        <span className={styles.subreddit}>{sourceLabel(subreddit)}</span>
      </div>
    </div>
  );
};

export default SourceCard;
