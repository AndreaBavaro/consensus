import React, { useMemo, useCallback } from 'react';
import styles from './FilterControls.module.css';

const FilterControls = ({ sortBy, onSortChange }) => {
  // Memoize sort button handlers
  const handleRelevanceClick = useCallback(() => 
    onSortChange(sortBy === 'relevance' ? null : 'relevance'),
    [sortBy, onSortChange]
  );

  const handleUpvotesClick = useCallback(() => 
    onSortChange(sortBy === 'upvotes' ? null : 'upvotes'),
    [sortBy, onSortChange]
  );

  const handleDateClick = useCallback(() => 
    onSortChange(sortBy === 'date' ? null : 'date'),
    [sortBy, onSortChange]
  );

  // Memoize button class strings
  const relevanceButtonClass = useMemo(() => 
    `${styles.sortButton} ${sortBy === 'relevance' ? styles.active : ''}`,
    [sortBy]
  );

  const upvotesButtonClass = useMemo(() => 
    `${styles.sortButton} ${sortBy === 'upvotes' ? styles.active : ''}`,
    [sortBy]
  );

  const dateButtonClass = useMemo(() => 
    `${styles.sortButton} ${sortBy === 'date' ? styles.active : ''}`,
    [sortBy]
  );

  return (
    <div className={styles.container}>
      <div className={styles.sortButtons}>
        <button
          className={relevanceButtonClass}
          onClick={handleRelevanceClick}
        >
          Relevance
        </button>
        <button
          className={upvotesButtonClass}
          onClick={handleUpvotesClick}
        >
          Upvotes
        </button>
        <button
          className={dateButtonClass}
          onClick={handleDateClick}
        >
          Date
        </button>
      </div>
    </div>
  );
};

export default React.memo(FilterControls);
