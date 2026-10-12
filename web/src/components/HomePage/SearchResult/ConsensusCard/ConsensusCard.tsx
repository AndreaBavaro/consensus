import React, { useMemo } from 'react';
import styles from './ConsensusCard.module.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartBar, faChartSimple, faStar } from '@fortawesome/free-solid-svg-icons';
import ThemeV2 from './ThemeV2';
import FilterControls from '../FilterControls/FilterControls';

const ConsensusCard = ({ 
  opinions, 
  onThemeClick, 
  onThemeExpand,
  onShowComments,
  expandedThemes,
  activeCommentTheme,
  selectedThemes,
  sortBy,
  onSortChange
}) => {
  // Check if all themes have their data loaded
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.desktopHeader}>
          <FontAwesomeIcon icon={faStar} className={styles.logo} />
          <span className={styles.logoText}>Key Insights</span>
          <div className={styles.filterControls}>
            <FilterControls 
              sortBy={sortBy}
              onSortChange={onSortChange}
            />
          </div>
        </div>
      </div>
      <div className={styles.themes}>
        {opinions && opinions
          .filter(opinion => opinion.title.toLowerCase() !== 'other')
          .sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0))
          .map((opinion, index) => (
          <ThemeV2
            key={opinion.title}
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
  );
};

export default ConsensusCard;
