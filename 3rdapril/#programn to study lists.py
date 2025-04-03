#programn to study lists
print("Welcome")
no_entries=input("Enter the number of entries to be added in the list=")
counter=int(no_entries)
user_list=[]
while(counter>0):
    user_list.append(int(input("Enter integer item=")))
    counter-=1
print(user_list)
sum_result=0
[sum_result:=sum_result+x for x in user_list]     
print("Sum=",sum_result)
sum_result=sum(user_list)
print("Sum using function=",sum_result)
print("Finished")