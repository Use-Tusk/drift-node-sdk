import { Sequelize, DataTypes, Model, Optional } from 'sequelize';

// Database configuration
const dbConfig = {
  host: process.env.MYSQL_HOST || 'mysql',
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  database: process.env.MYSQL_DB || 'testdb',
  username: process.env.MYSQL_USER || 'testuser',
  password: process.env.MYSQL_PASSWORD || 'testpass',
};

// Initialize Sequelize instance
export const sequelize = new Sequelize(
  dbConfig.database,
  dbConfig.username,
  dbConfig.password,
  {
    host: dbConfig.host,
    port: dbConfig.port,
    dialect: 'mysql',
    logging: console.log,
  }
);

// Define User interface
interface UserAttributes {
  id: number;
  name: string;
  email: string;
  created_at?: Date;
}

interface UserCreationAttributes extends Optional<UserAttributes, 'id' | 'created_at'> {}

// Define User model
export class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  public id!: number;
  public name!: string;
  public email!: string;
  public created_at!: Date;
}

User.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'test_users',
    timestamps: false,
  }
);

// Define Product interface for a new table
interface ProductAttributes {
  id: number;
  name: string;
  price: number;
  stock: number;
  created_at?: Date;
}

interface ProductCreationAttributes extends Optional<ProductAttributes, 'id' | 'created_at'> {}

// Define Product model
export class Product extends Model<ProductAttributes, ProductCreationAttributes> implements ProductAttributes {
  public id!: number;
  public name!: string;
  public price!: number;
  public stock!: number;
  public created_at!: Date;
}

Product.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    stock: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'products',
    timestamps: false,
  }
);

// Initialize Sequelize and sync models
export async function initializeSequelize() {
  console.log('Initializing Sequelize connection...');

  // This will trigger internal Sequelize queries like SELECT VERSION()
  await sequelize.authenticate();
  console.log('Sequelize connection authenticated successfully');

  // Create products table if it doesn't exist
  await Product.sync();
  console.log('Products table synced');

  // Insert some test products with fixed timestamp for deterministic replay
  const existingProducts = await Product.count();
  if (existingProducts === 0) {
    const fixedTimestamp = new Date('2025-01-01T00:00:00.000Z');
    await Product.bulkCreate([
      { name: 'Laptop', price: 999.99, stock: 10, created_at: fixedTimestamp },
      { name: 'Mouse', price: 29.99, stock: 50, created_at: fixedTimestamp },
      { name: 'Keyboard', price: 79.99, stock: 30, created_at: fixedTimestamp },
      { name: 'Monitor', price: 299.99, stock: 15, created_at: fixedTimestamp },
    ]);
    console.log('Test products created');
  }
}
