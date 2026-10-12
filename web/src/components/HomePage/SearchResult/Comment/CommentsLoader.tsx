import React from 'react';
import styles from './CommentsLoader.module.css';

const CommentsLoader = ({ consensusLoaded }) => {
  return (
    <div className={styles.loader}>
      <div className={styles.content}>
        <div className={styles.spinner} />
        <p className={`${styles.text} ${styles.flash}`}>
          {consensusLoaded ? 'Analyzing comments...' : 'Collecting sources...'}
        </p>
      </div>
    </div>
  );
};

export default CommentsLoader;
