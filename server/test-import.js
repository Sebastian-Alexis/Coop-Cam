import('./src/app.js')
  .then(app => {
    console.log('App imported:', !!app.app);
    console.log('Keys:', Object.keys(app));
  })
  .catch(err => {
    console.error('Error:', err.message);
    console.error(err.stack);
  });