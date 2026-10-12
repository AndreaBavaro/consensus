import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './globals.css';
import HomePage from './components/HomePage/HomePage';
import SearchPage from './components/HomePage/SearchPage';
import { SessionProvider } from './context/SessionContext';
import './App.css';

function App() {
  return (
    <Router>
      <SessionProvider>
        <div className="App">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </div>
      </SessionProvider>
    </Router>
  );
}

export default App;
