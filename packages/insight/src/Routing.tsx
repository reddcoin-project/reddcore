import {lazy, Suspense} from 'react';
import {Navigate, Route, Routes} from 'react-router-dom';
import Home from './pages';
const Blocks = lazy(() => import('./pages/blocks'));
const Block = lazy(() => import('./pages/block'));
const TransactionHash = lazy(() => import('./pages/transaction'));
const Address = lazy(() => import('./pages/address'));
const RichList = lazy(() => import('./pages/rich-list'));
const DormantList = lazy(() => import('./pages/dormant-list'));
const ActiveList = lazy(() => import('./pages/active-list'));
const Stats = lazy(() => import('./pages/stats'));
const Search = lazy(() => import('./pages/search'));

function Routing() {
  return (
    <Suspense>
      <Routes>
        <Route path='/' element={<Home />} />
        <Route path='/:currency/:network/blocks' element={<Blocks />} />
        <Route path='/:currency/:network/block/:block' element={<Block />} />
        <Route path='/:currency/:network/tx/:tx' element={<TransactionHash />} />
        <Route path='/:currency/:network/address/:address' element={<Address />} />
        <Route path='/:currency/:network/stats' element={<Stats />} />
        <Route path='/:currency/:network/rich-list' element={<RichList />} />
        <Route path='/:currency/:network/dormant' element={<DormantList />} />
        <Route path='/:currency/:network/active' element={<ActiveList />} />
        <Route path='/search' element={<Search />} />
        {/* 404 redirect to home page */}
        <Route path='*' element={<Navigate to='/' />} />
      </Routes>
    </Suspense>
  );
}

export default Routing;
