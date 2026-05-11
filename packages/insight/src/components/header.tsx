import Search from './search';
import styled from 'styled-components';
import {device} from '../utilities/constants';
import {AnimatePresence, motion} from 'framer-motion';
import InsightLogo from './icons/insight-logo';
import {useNavigate, useLocation} from 'react-router-dom';
import ThemeChanger from './theme-changer';
import {Feather} from '../assets/styles/colors';
import {HeaderHeight, HeaderZIndex} from '../assets/styles/global';
import {memo} from 'react';
import {useAppSelector} from '../utilities/hooks';

const HeaderDiv = styled.div`
  position: fixed;
  height: ${HeaderHeight};
  width: 100%;
  left: 0;
  top: 0;
  display: flex;
  padding: 1rem calc((100% - 992px) / 4);
  background: ${({theme: {dark}}) => (dark ? '#090909' : Feather)};
  align-items: center;
  z-index: ${HeaderZIndex};
  @media screen and (max-width: 992px) {
    padding: 1rem;
  }
`;

const ImageDiv = styled.div`
  margin-right: 2rem;
  display: flex;

  svg {
    min-width: 89px;
    min-height: 27px;

    &:hover {
      cursor: pointer;
    }
  }
`;

const ToggleDiv = styled.div`
  margin-left: auto;
`;

const NavLinks = styled.nav`
  display: flex;
  gap: 1.25rem;
  align-items: center;
  margin-right: 1.5rem;
  font-size: 0.95em;
  @media screen and (max-width: 992px) {
    margin-right: 0.75rem;
    gap: 0.75rem;
  }
`;

const NavLink = styled.span<{$active?: boolean}>`
  cursor: pointer;
  color: ${({$active, theme: {dark}}) =>
    $active ? (dark ? '#7ab' : '#06c') : dark ? '#eee' : '#222'};
  font-weight: ${({$active}) => ($active ? 600 : 400)};
  &:hover {
    color: ${({theme: {dark}}) => (dark ? '#7ab' : '#06c')};
  }
`;

const DesktopSearch = styled(motion.div)`
  display: none;
  @media screen and ${device.tablet} {
    display: flex;
    width: 100%;
  }
`;

export const fadeInOut = {
  animate: {
    opacity: 1,
    transition: {
      bounce: 0,
      duration: 0.03,
      ease: 'easeOut',
    },
  },
  initial: {
    opacity: 0,
  },
  exit: {
    opacity: 0,
  },
};

const Header = ({setSearchError}: {setSearchError?: any}) => {
  const navigate = useNavigate();
  const location = useLocation();
  // Read the currently-selected chain from Redux. Set by every per-chain
  // page on mount via changeCurrency/changeNetwork. When unset (e.g. on
  // /, /search, or initial paint) we hide the Stats link rather than
  // guess a chain.
  const currency = useAppSelector(s => s.APP.currency);
  const network = useAppSelector(s => s.APP.network);
  const hasChain = !!currency && !!network;

  const goHome = () => {
    navigate('/');
  };

  const gotoStats = () => {
    if (hasChain) navigate(`/${currency}/${network}/stats`);
  };

  return (
    <HeaderDiv>
      <ImageDiv onClick={() => goHome()}>
        <InsightLogo />
      </ImageDiv>
      {hasChain && (
        <NavLinks>
          <NavLink $active={location.pathname.endsWith('/stats')} onClick={gotoStats}>
            Stats
          </NavLink>
        </NavLinks>
      )}
      <AnimatePresence>
        {location.pathname !== '/' && (
          <DesktopSearch variants={fadeInOut} animate='animate' initial='initial' exit='exit'>
            <Search setErrorMessage={setSearchError} />
          </DesktopSearch>
        )}
      </AnimatePresence>

      <ToggleDiv>
        <ThemeChanger />
      </ToggleDiv>
    </HeaderDiv>
  );
};

export default memo(Header);
