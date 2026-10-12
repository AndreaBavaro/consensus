import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartBar } from '@fortawesome/free-solid-svg-icons';
import styles from './MobileLogo.module.css';

const MobileLogo = () => {
  return (
    <div className={styles.container}>
      <FontAwesomeIcon icon={faChartBar} className={styles.logo} />
      <span className={styles.text}>Consensus</span>
    </div>
  );
};

export default MobileLogo;
