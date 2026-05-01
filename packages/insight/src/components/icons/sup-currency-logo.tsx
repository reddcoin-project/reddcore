import styled from 'styled-components';
import {motion, useAnimation} from 'framer-motion';
import {imageFadeIn} from 'src/utilities/animations';
import {getCurrencyIcon} from 'src/utilities/helper-methods';

const CurrencyIcon = styled(motion.sup)`
  margin-left: 3px;
`;

const SupCurrencyLogo = ({currency}: {currency: string}) => {
  const animationControls = useAnimation();
  const imgSrc = getCurrencyIcon(currency);

  return (
    <CurrencyIcon variants={imageFadeIn} initial='initial' animate={animationControls}>
      <img
        src={imgSrc}
        width={22}
        height={22}
        alt={currency + ' logo'}
        onLoad={() => animationControls.start('animate')}
      />
    </CurrencyIcon>
  );
};

export default SupCurrencyLogo;
