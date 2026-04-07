import {connect} from 'react-redux';

import type {HyperState} from '../../typings/hyper';
import StatusBar from '../components/status-bar';

const mapStateToProps = (state: HyperState) => ({
  remoteLocalUrl: state.ui.remoteLocalUrl,
  remoteLanUrl: state.ui.remoteLanUrl,
  borderColor: state.ui.borderColor
});

export const StatusBarContainer = connect(mapStateToProps)(StatusBar);
