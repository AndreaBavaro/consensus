import React from 'react';
import styles from './InsightLoader.module.css';

const InsightLoader = () => {
  return (
    <div className={styles.insightLoaderGrid}>
      {[...Array(6)].map((_, index) => (
        <div key={index} className={styles.loaderCard}>
          <div className={styles.shimmerWrapper}>
            <div className={styles.quoteIcon} />
            <div className={styles.contentLines}>
              <div className={styles.line} style={{ width: '90%' }} />
              <div className={styles.line} style={{ width: '75%' }} />
              <div className={styles.line} style={{ width: '85%' }} />
            </div>
            <div className={styles.footer}>
              <div className={styles.metaInfo}>
                <div className={styles.commentButton} />
                <div className={styles.stats} />
              </div>
              <div className={styles.sentiment} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default InsightLoader;
