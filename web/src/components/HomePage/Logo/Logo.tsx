import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartBar } from '@fortawesome/free-solid-svg-icons';
import styles from './Logo.module.css';

const Logo = () => {
  return (
    <div className={styles.logo_wrapper}>
      <div className={styles.logo_container}>
        <h2 className={styles.logo_text}>Find out what people are thinking</h2>
       
      </div>
    </div>
  );
};

export default Logo;
