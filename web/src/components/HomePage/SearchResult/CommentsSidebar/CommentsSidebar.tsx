import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import FilterControls from '../FilterControls/FilterControls';
import styles from './CommentsSidebar.module.css';

const CommentsSidebar = ({ 
  isOpen, 
  onClose, 
  theme,
  children,
  sortBy,
  onSortChange
}) => {
  return (
    <div className={`${styles.sidebar} ${isOpen ? styles.open : ''}`}>
      <div className={styles.header}>
        <span className={styles.sortLabel}>Sort by:</span>
        <button 
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close comments"
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>
      <div className={styles.filterSection}>
        <FilterControls
          sortBy={sortBy}
          onSortChange={onSortChange}
        />
      </div>
      <div className={styles.content}>
        {children}
      </div>
    </div>
  );
};

export default CommentsSidebar;
