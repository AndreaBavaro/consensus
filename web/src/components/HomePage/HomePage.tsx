import React from 'react';
import Logo from './Logo/Logo';
import SearchBar from './SearchBar/SearchBar';
import SuggestionCards from './SuggestionCards/SuggestionCards';
import Sidebar from '../Sidebar/Sidebar';
import styles from './HomePage.module.css';

const HomePage = () => (
  <div className={styles.pageWrapper}>
    <Sidebar />
    <div className={styles.container}>
      <div className={styles.contentWrapper}>
        <div className={styles.logo_wrapper}>
          <Logo />
        </div>
        <SearchBar isHomePage={true} />
        <SuggestionCards />
      </div>
    </div>
  </div>
);

export default HomePage;
