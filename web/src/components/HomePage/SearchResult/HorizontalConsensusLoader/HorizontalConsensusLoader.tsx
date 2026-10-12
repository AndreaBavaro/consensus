import React from 'react';
import styles from './HorizontalConsensusLoader.module.css';

const HorizontalConsensusLoader = () => {
  return (
    <div className={styles.loaderContainer}>
      <div className={styles.mainContent}>
        <div className={styles.header}>
          <div className={styles.titleBar} />
          <div className={styles.subtitleBar} />
        </div>
        <div className={styles.themeContainer}>
          {[...Array(3)].map((_, index) => (
            <div key={index} className={styles.themeItem}>
              <div className={styles.themeIcon} />
              <div className={styles.themeContent}>
                <div className={styles.themeLine} style={{ width: '80%' }} />
                <div className={styles.themeLine} style={{ width: '60%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.glowEffect} />
    </div>
  );
};

export default HorizontalConsensusLoader;
