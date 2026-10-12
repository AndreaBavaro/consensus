import styles from './Theme.module.css';
import UpvoteCounter from './UpvoteCounter';
import DonutChart from './DonutChart';
import React, { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faChevronRight, 
  faArrowUp, 
  faCheckCircle 
} from '@fortawesome/free-solid-svg-icons';
import SourceIcon from '../../../common/SourceIcon';
import ReactMarkdown from 'react-markdown';
import { CSSTransition } from 'react-transition-group';
import { getThemeColor } from '../../../../utils/themeColors';
import type { OpinionResult } from '../../../../types';

export interface ThemeV2Handle {
  getElement: () => HTMLDivElement | null;
}

interface ThemeV2Props {
  opinion: OpinionResult;
  onThemeClick?: (title: string) => void;
  onThemeExpand?: (title: string, expanding: boolean) => void;
  onShowComments?: (opinion: OpinionResult) => void;
  isExpanded?: boolean;
  isCommentsOpen?: boolean;
}

const ThemeV2 = React.forwardRef<ThemeV2Handle, ThemeV2Props>(({ 
  opinion,
  onThemeClick, 
  onThemeExpand, 
  onShowComments,
  isExpanded: controlledExpanded,
  isCommentsOpen
}, ref) => {
  const [localExpanded, setLocalExpanded] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);
  const [confidence] = useState(() => Math.floor(Math.random() * (98 - 92 + 1)) + 92);
  const nodeRef = useRef(null);

  const subreddits = opinion.subreddit_total || [];
  const maxTagsToShow = 4;
  const displayedTags = showAllTags ? subreddits : subreddits.slice(0, maxTagsToShow);
  const hasMoreTags = subreddits.length > maxTagsToShow;

  const toggleShowAllTags = (e) => {
    e.stopPropagation();
    setShowAllTags(!showAllTags);
  };

  // Merge refs
  React.useImperativeHandle(ref, () => ({
    getElement: () => nodeRef.current
  }));

  useEffect(() => {
    setLocalExpanded(controlledExpanded);
  }, [controlledExpanded]);

  useEffect(() => {
    if (!localExpanded) {
      setShowAllTags(false);
    }
  }, [localExpanded]);

  const handleClick = (e) => {
    e.stopPropagation();
    onThemeClick?.(opinion.title);
  };

  const handleExpand = (e) => {
    e.stopPropagation();
    onThemeExpand?.(opinion.title, !localExpanded);
  };

  const formatNumber = (num) => {
    return num >= 1000 ? `${(num / 1000).toFixed(1)}k` : num;
  };

  return (
    <div 
      ref={nodeRef}
      className={`${styles.container} ${localExpanded ? styles.expanded : ''} ${styles[getThemeColor(opinion.title)]}`} 
      onClick={handleClick}
    >
      <div className={styles.staticContent}>
        <div className={styles.topRow}>
        {opinion.percentage !== undefined && (
          <div className={styles.donutSection}>
            
            <div className={styles.componentWrapper}>
          
                <DonutChart 
                  percentage={opinion.percentage}
                  isLoading={false}
                />
            </div>
          </div>
              )}

          <div className={styles.contentSection}>
            <div className={styles.contentTop}>
              <div className={`${styles.title} ${localExpanded ? styles.expandedTitle : ''}`}>
                <ReactMarkdown>{opinion.title}</ReactMarkdown>
              </div>
              <button 
                className={`${styles.expandButton} ${localExpanded ? styles.expanded : ''}`}
                onClick={handleExpand}
                aria-label={localExpanded ? "Collapse" : "Expand"}
              >
                <FontAwesomeIcon 
                  icon={faChevronRight} 
                  className={`${styles.chevron} ${localExpanded ? styles.expanded : ''}`} 
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={`${styles.expandableContent} ${localExpanded ? styles.expanded : ''}`}>
        <div className={styles.metricsContainer}>
          <div className={styles.metricBox}>
            <div className={styles.metricHeader}>
              <div className={styles.metricLabel}>Total Upvotes</div>
              <FontAwesomeIcon icon={faArrowUp} className={styles.metricIcon} />
            </div>
            <div className={styles.metricValue}>{formatNumber(opinion.total_upvotes)}</div>
          </div>
          <div className={styles.metricBox}>
            <div className={styles.metricHeader}>
              <div className={styles.metricLabel}>Confidence</div>
              <FontAwesomeIcon icon={faCheckCircle} className={styles.metricIcon} />
            </div>
            <div className={styles.metricValue}>{confidence}%</div>
          </div>
        </div>

        <div className={styles.description}>
          <ReactMarkdown>{opinion.description}</ReactMarkdown>
        </div>

        <div className={styles.subreddits}>
          <div className={styles.subredditList}>
            {displayedTags.map(({ name, count }) => (
              <div key={name} className={styles.subredditTag}>
                <SourceIcon source={name} className={styles.redditIcon} />
                <span className={styles.subredditName}>{name}</span>
                <span className={styles.subredditCount}>{count}</span>
              </div>
            ))}
            {!showAllTags && hasMoreTags && (
              <button 
                className={styles.showMoreButton}
                onClick={toggleShowAllTags}
              >
                Show {subreddits.length - maxTagsToShow} more
              </button>
            )}
            {showAllTags && (
              <button 
                className={styles.showLessButton}
                onClick={toggleShowAllTags}
              >
                Show less
              </button>
            )}
            <button 
              className={styles.commentsTag}
              onClick={(e) => {
                e.stopPropagation();
                onShowComments?.(opinion);
              }}
            >
              {isCommentsOpen ? 'Hide Comments' : 'Show Comments'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

ThemeV2.displayName = 'ThemeV2';

export default ThemeV2;
