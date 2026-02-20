npx tsc --noEmit --project tsconfig.json


Stock Reports:
-in here first of all we will add the supplier in stock creation and in re stocking we add the field of the supplie so that we know from where and in re stocking we have differeent supplier so we have to keep that record,  
-then when issuing stock to the shop its important to keep those records we want to know what we issued to a shop on a specific date
HP Sales: 
I'll add "Phone" and "Location" fields  for HP client salesand regular client sales and they shouldbe optional. include this in reciept
Product Swapping: 
-I'll implement a new feature to handle product exchanges.
we should add the product swapping tab in the shop sales where when you give us the product  we will know the quantity and and increase that product qtyand we willbe knowing te product through product code and we will be knowing the shop through shop id but you can know through capturing the shopthat is opened i dont need to tell it to you, then after he product qty will increase and the taken decrease, then lookfor a way toinclude that in my sales reports there in sales
make a reciept for this
promotions:
-as we arleady implemented it we will add in this the configuring of the promotions that capture the whole  products like we have a promotion if you buy from us and in the reciept you add up all the bv and it reaches 100 you win something so our config should choose bv or pv and tell the qty to trigure it  so that we capture it when saling products and this is trigure in the whole sale reciept when you add it up and ofcose include that even n our promotion tab and we shouldhave the filters for daily audit and date range as we had in the my sales report include this in the reciept
A5 Printing: I'll optimize all printouts (receipts and reports) to fit perfectly on A5 paper.