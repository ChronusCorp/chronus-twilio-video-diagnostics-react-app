import { createStyles, makeStyles, Theme } from '@material-ui/core';
import { AppStateProvider } from './components/AppStateProvider/AppStateProvider';
import Header from './components/Header/Header';
import { MainContent } from './components/MainContent/MainContent';

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    appContainer: {
      position: 'relative',
      width: '100%',
      height: '100%',
      background: theme.backgroundColor,
      overflow: 'hidden',
      [theme.breakpoints.down('sm') + theme.includeLandscapeMd]: {
        overflowY: 'auto',
        paddingTop: '2em',
      },
    },
  })
);

function App() {
  const classes = useStyles();

  return (
    <AppStateProvider>
      <div className={classes.appContainer}>
        <Header />
        <MainContent />
      </div>
    </AppStateProvider>
  );
}

export default App;
