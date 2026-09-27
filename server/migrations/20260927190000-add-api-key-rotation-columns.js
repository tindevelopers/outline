"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        "apiKeys",
        "previousHash",
        {
          type: Sequelize.STRING,
          allowNull: true,
          unique: true,
        },
        { transaction }
      );

      await queryInterface.addColumn(
        "apiKeys",
        "previousHashExpiresAt",
        {
          type: Sequelize.DATE,
          allowNull: true,
        },
        { transaction }
      );
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn("apiKeys", "previousHash", {
        transaction,
      });
      await queryInterface.removeColumn("apiKeys", "previousHashExpiresAt", {
        transaction,
      });
    });
  },
};
