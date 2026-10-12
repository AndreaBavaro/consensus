import React from 'react';
import styles from './HorizontalConsensusCard.module.css';
import ThemeV2 from '../ConsensusCard/ThemeV2';
import DateBadge from '../DateBadge/DateBadge';
import OpinionLogo from './OpinionLogo';

const HorizontalConsensusCard = ({ 
  opinions, 
  onThemeClick, 
  onThemeExpand, 
  onShowComments,
  expandedThemes,
  activeCommentTheme,
  dateFilter,
  fromDate,
  toDate
}) => {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <OpinionLogo className={styles.logo} />
          <span className={styles.logoText}>Opinion Poll</span>
        </div>
       
      </div>
      <div className={styles.themesContainer}>
        <div className={styles.themes}>
          {opinions && opinions
            .filter(opinion => opinion.title.toLowerCase() !== 'other')
            .sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0))
            .map((opinion, index) => (
              <ThemeV2
                key={`${opinion.title}-${index}`}
                opinion={opinion}
                onThemeClick={onThemeClick}
                onThemeExpand={onThemeExpand}
                onShowComments={onShowComments}
                isExpanded={expandedThemes.has(opinion.title)}
                isCommentsOpen={activeCommentTheme?.title === opinion.title}
              />
            ))}
        </div>
      </div>
    </div>
  );
};

export default React.memo(HorizontalConsensusCard);
