INSERT INTO products(barcode,name,category,price,stock,reorder_level) VALUES
('8901001','Coca Cola 50cl','Beverages',500,20,5),
('8901002','Peak Milk 400g','Dairy',1500,10,5),
('8901003','Indomie Chicken','Groceries',300,50,10),
('8901004','Golden Penny Semovita 1kg','Groceries',1850,8,5),
('8901005','Eva Water 75cl','Beverages',350,4,5),
('8901006','Sunlight Detergent 1kg','Household',2250,12,5)
ON CONFLICT(barcode) DO NOTHING;
