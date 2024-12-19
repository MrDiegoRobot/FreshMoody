const sql = require('mssql');

// Configuration object for the SQL Server connection
const config = {
    user: 'pwedipie',
    password: 'god123',
    server: 'LAPTOP-5N4CD2PM',
    database: 'FreshmoodyDB',
    options: {
        encrypt: true,
        trustServerCertificate: true,
        port: 1433
    }
};

// Create a connection pool
const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
        console.log('Connected to SQL Server successfully!');
        return pool;
    })
    .catch(err => {
        console.error('Error connecting to SQL Server:', err);
        process.exit(1);
    });

module.exports = { sql, poolPromise };

